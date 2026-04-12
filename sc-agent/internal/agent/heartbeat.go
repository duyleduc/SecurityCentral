package agent

import (
	"context"
	"time"

	"github.com/securitycentral/sc-agent/internal/config"
	"github.com/securitycentral/sc-agent/internal/logging"
	"github.com/securitycentral/sc-agent/internal/platform"
	"github.com/securitycentral/sc-agent/internal/sysinfo"
)

const (
	collectInterval = 1 * time.Second
	normalInterval  = 60 * time.Second
	urgentDebounce  = 15 * time.Second
)

type Agent struct {
	cfg        *config.Config
	client     *platform.Client
	log        *logging.Logger
	ring       *RingBuffer
	alertBuf   *AlertBuffer
	thresholds ThresholdConfig
}

func New(cfg *config.Config, log *logging.Logger) *Agent {
	client := platform.NewClient(cfg.APIBaseURL, cfg.APIKey)
	return &Agent{
		cfg:    cfg,
		client: client,
		log:    log,
		ring:   NewRingBuffer(),
		alertBuf: NewAlertBuffer(),
		thresholds: ThresholdConfig{
			CPUPercent:  cfg.CPUThresh,
			RAMPercent:  cfg.RAMThresh,
			DiskPercent: cfg.DiskThresh,
		},
	}
}

// Run starts the collect loop and send loop, blocking until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) {
	go a.collectLoop(ctx)
	a.sendLoop(ctx)
}

// collectLoop samples metrics every 1s and checks thresholds.
func (a *Agent) collectLoop(ctx context.Context) {
	ticker := time.NewTicker(collectInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m, err := sysinfo.CollectMetrics()
			if err != nil {
				a.log.Error("collect metrics failed", map[string]interface{}{"error": err.Error()})
				continue
			}

			a.ring.Push(m)

			alerts := CheckThresholds(m, a.thresholds)
			if len(alerts) > 0 {
				a.alertBuf.Push(alerts)
				a.log.Warn("threshold alerts detected", map[string]interface{}{"count": len(alerts)})
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
		AgentVersion: "0.1.0",
		CPUCores:     sysInfo.CPUCores,
		CPUModel:     sysInfo.CPUModel,
		TotalRAMMB:   sysInfo.TotalRAMMB,
		TotalDiskGB:  sysInfo.TotalDiskGB,
		IPAddresses:  sysInfo.IPAddresses,
	}

	for {
		select {
		case <-ctx.Done():
			// Send final heartbeat before exit
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

	metrics := a.ring.Aggregate()

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
		"urgent": urgent,
		"alerts": len(alerts),
		"cpu":    metrics.CPU.Avg,
		"ram":    metrics.RAM.Avg,
		"disk":   metrics.Disk.Usage,
	})
}
