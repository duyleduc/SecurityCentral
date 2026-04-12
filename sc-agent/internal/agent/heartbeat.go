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
		}
	}
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
