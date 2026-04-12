package agent

import (
	"context"
	"time"

	"github.com/securitycentral/sc-agent/internal/collector"
	"github.com/securitycentral/sc-agent/internal/config"
	"github.com/securitycentral/sc-agent/internal/logging"
	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

const (
	normalInterval = 60 * time.Second
	urgentDebounce = 15 * time.Second
)

type Agent struct {
	cfg        *config.Config
	client     *platform.Client
	log        *logging.Logger
	scheduler  *Scheduler
	store      *MetricStore
	alertBuf   *AlertBuffer
	thresholds *ThresholdChecker
	spike      *SpikeDetector
}

func New(cfg *config.Config, log *logging.Logger) *Agent {
	client := platform.NewClient(cfg.APIBaseURL, cfg.APIKey)

	// Build collector registry — register all metric domains.
	reg := collector.NewRegistry()
	reg.Register(collector.NewCPU())
	reg.Register(collector.NewMemory())
	reg.Register(collector.NewDisk())
	reg.Register(collector.NewNetwork())
	reg.Register(collector.NewProcess())
	reg.Register(collector.NewService())
	reg.Register(collector.NewSecurity())
	reg.Register(collector.NewDocker())
	reg.Register(collector.NewPackageInventory())

	return &Agent{
		cfg:       cfg,
		client:    client,
		log:       log,
		scheduler: NewScheduler(reg, log),
		store:     NewMetricStore(),
		alertBuf:  NewAlertBuffer(),
		thresholds: NewThresholdChecker(ThresholdConfig{
			CPUPercent:    cfg.CPUThresh,
			RAMPercent:    cfg.RAMThresh,
			DiskPercent:   cfg.DiskThresh,
			IOWaitPercent: cfg.IOWaitThresh,
			SpikePercent:  cfg.SpikeThresh,
		}),
		spike: &SpikeDetector{},
	}
}

// Run starts the scheduler, processLoop, and sendLoop. Blocks until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) {
	results := a.scheduler.Run(ctx)
	go a.processLoop(ctx, results)
	a.sendLoop(ctx)
}

// processLoop consumes snapshots from the scheduler, stores them, and checks thresholds.
func (a *Agent) processLoop(ctx context.Context, results <-chan collector.Snapshot) {
	for {
		select {
		case <-ctx.Done():
			return
		case snap, ok := <-results:
			if !ok {
				return
			}
			a.store.Update(snap)

			alerts := a.thresholds.CheckSnapshot(snap)
			if len(alerts) > 0 {
				a.alertBuf.Push(alerts)
				a.log.Warn("threshold alerts detected", map[string]interface{}{
					"collector": snap.Key,
					"count":     len(alerts),
				})
			}

			// Security posture goes to a separate endpoint (too large for heartbeat).
			if snap.Key == "security" {
				go a.sendSecurityPosture()
			}
			// Package inventory goes to a separate endpoint (daily, large payload).
			if snap.Key == "packages" {
				go a.sendPackageInventory()
			}
		}
	}
}

func (a *Agent) sendSecurityPosture() {
	sec, ok := a.store.LatestSecurity()
	if !ok {
		return
	}

	req := platform.SecurityPostureRequest{
		AgentID:       a.cfg.AgentID,
		CollectedAt:   time.Now().UTC().Format(time.RFC3339),
		PendingReboot: sec.PendingReboot,
		SSHFailures:   sec.SSHFailures,
		ShellUsers:    sec.ShellUsers,
		SSHConfig: platform.SSHConfig{
			RootLogin:      sec.SSHConfig.RootLogin,
			PasswordAuth:   sec.SSHConfig.PasswordAuth,
			Port:           sec.SSHConfig.Port,
			PermitEmptyPwd: sec.SSHConfig.PermitEmptyPwd,
		},
		Firewall: platform.FWInfo{
			Active: sec.Firewall.Active,
			Type:   sec.Firewall.Type,
		},
		OpenFDs: platform.FDEntry{
			Allocated: sec.OpenFDs.Allocated,
			Max:       sec.OpenFDs.Max,
		},
	}

	for _, p := range sec.ListeningPorts {
		req.ListeningPorts = append(req.ListeningPorts, platform.PortEntry{
			Port: p.Port, Proto: p.Proto, Process: p.Process, Bind: p.Bind,
		})
	}
	for _, s := range sec.LoggedInUsers {
		req.LoggedInUsers = append(req.LoggedInUsers, platform.SessionInfo{
			User: s.User, From: s.From, Since: s.Since,
		})
	}

	if err := a.client.SendSecurityPosture(req); err != nil {
		a.log.Error("security posture send failed", map[string]interface{}{"error": err.Error()})
		return
	}
	a.log.Info("security posture sent", map[string]interface{}{
		"ports":      len(req.ListeningPorts),
		"sshFails":   req.SSHFailures,
		"shellUsers": len(req.ShellUsers),
	})
}

func (a *Agent) sendPackageInventory() {
	snap, ok := a.store.Latest("packages")
	if !ok {
		return
	}
	pkg, ok := snap.Data.(collector.PackageData)
	if !ok {
		return
	}

	req := platform.PackageInventoryRequest{
		AgentID:                a.cfg.AgentID,
		CollectedAt:            time.Now().UTC().Format(time.RFC3339),
		OSFamily:               pkg.OSFamily,
		PendingSecurityUpdates: pkg.PendingSecurityUpdates,
		HeldPackages:           pkg.HeldPackages,
		KernelRunning:          pkg.KernelRunning,
		KernelInstalled:        pkg.KernelInstalled,
		UnattendedUpgrades:     pkg.UnattendedUpgrades,
		PackageHash:            pkg.PackageHash,
	}
	for _, p := range pkg.Packages {
		req.Packages = append(req.Packages, platform.PkgEntry{
			Name: p.Name, Version: p.Version, Arch: p.Arch,
		})
	}
	for _, b := range pkg.BinaryVersions {
		req.BinaryVersions = append(req.BinaryVersions, platform.BinaryVer{
			Name: b.Name, Version: b.Version,
		})
	}

	if err := a.client.SendPackageInventory(req); err != nil {
		a.log.Error("package inventory send failed", map[string]interface{}{"error": err.Error()})
		return
	}
	a.log.Info("package inventory sent", map[string]interface{}{
		"packages": len(req.Packages),
		"binaries": len(req.BinaryVersions),
		"hash":     req.PackageHash,
	})
}

// sendLoop sends heartbeats: urgent after 15s debounce, normal every 60s.
func (a *Agent) sendLoop(ctx context.Context) {
	normalTicker := time.NewTicker(normalInterval)
	urgentTicker := time.NewTicker(urgentDebounce)
	defer normalTicker.Stop()
	defer urgentTicker.Stop()

	sysInfo := sysinfo.GetSystemInfo()
	sys := &platform.SystemData{
		Hostname:     sysInfo.Hostname,
		OS:           sysInfo.Platform,
		OSVersion:    sysInfo.Version,
		Kernel:       sysInfo.Kernel,
		Arch:         sysInfo.Arch,
		AgentVersion: "0.2.0",
		CPUCores:     sysInfo.CPUCores,
		CPUModel:     sysInfo.CPUModel,
		TotalRAMMB:   sysInfo.TotalRAMMB,
		TotalDiskGB:  sysInfo.TotalDiskGB,
		IPAddresses:  sysInfo.IPAddresses,
	}

	for {
		select {
		case <-ctx.Done():
			// Send final heartbeat before exit.
			a.sendHeartbeat(false, nil, sys)
			return

		case <-urgentTicker.C:
			if a.alertBuf.HasAlerts() {
				alerts := a.alertBuf.Drain()
				a.sendHeartbeat(true, alerts, sys)
			}

		case <-normalTicker.C:
			alerts := a.alertBuf.Drain()
			urgent := len(alerts) > 0
			a.sendHeartbeat(urgent, alerts, sys)
		}
	}
}

func (a *Agent) sendHeartbeat(urgent bool, alerts []platform.Alert, sys *platform.SystemData) {
	if alerts == nil {
		alerts = []platform.Alert{}
	}

	metrics := a.store.AggregateMetrics()

	// Check for spikes between 60s windows.
	spikeAlerts := a.spike.UpdateAndCheck(
		metrics.CPU.Avg, metrics.RAM.Avg, a.cfg.SpikeThresh,
	)
	if len(spikeAlerts) > 0 {
		alerts = append(alerts, spikeAlerts...)
		urgent = true
	}

	req := platform.HeartbeatRequest{
		AgentID: a.cfg.AgentID,
		Urgent:  urgent,
		Alerts:  alerts,
		Metrics: metrics,
		System:  sys,
	}

	_, err := a.client.SendHeartbeat(req)
	if err != nil {
		a.log.Error("heartbeat send failed", map[string]interface{}{"error": err.Error()})
		return
	}

	a.log.Debug("heartbeat sent", map[string]interface{}{
		"urgent":  urgent,
		"alerts":  len(alerts),
		"cpu":     metrics.CPU.Avg,
		"ioWait":  metrics.CPU.IOWait,
		"ram":     metrics.RAM.Avg,
		"swap":    metrics.RAM.SwapUsedPct,
		"disk":    metrics.Disk.Usage,
		"diskIO":  metrics.Disk.IOUtilPct,
		"load1":   metrics.Load.Load1,
		"netRxBps": metrics.Network.RxBytesPerSec,
		"netTxBps": metrics.Network.TxBytesPerSec,
	})
}
