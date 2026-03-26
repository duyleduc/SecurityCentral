package agent

import (
	"log/slog"
	"time"
)

// ScanFunc is the function signature for running a scan.
type ScanFunc func() error

// Scheduler manages periodic scan execution and on-demand scan triggers.
type Scheduler struct {
	interval  time.Duration
	onStartup bool
	scanFn    ScanFunc
	cmdCh     <-chan Command
}

// NewScheduler creates a scan scheduler.
func NewScheduler(interval time.Duration, onStartup bool, scanFn ScanFunc, cmdCh <-chan Command) *Scheduler {
	return &Scheduler{
		interval:  interval,
		onStartup: onStartup,
		scanFn:    scanFn,
		cmdCh:     cmdCh,
	}
}

// Run starts the scan scheduler loop. Blocks forever.
func (s *Scheduler) Run() {
	if s.onStartup {
		slog.Info("running startup scan")
		s.executeScan()
	}

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			slog.Info("running scheduled scan")
			s.executeScan()

		case cmd := <-s.cmdCh:
			switch cmd.Type {
			case "scan_now":
				slog.Info("running on-demand scan (from heartbeat command)")
				s.executeScan()
			case "update_vulndb":
				slog.Info("updating vulnerability database")
				// VulnDB update would be triggered here
			case "update_agent":
				slog.Info("agent update requested", "payload", cmd.Payload)
				// Self-update would be triggered here
			default:
				slog.Warn("unknown command type", "type", cmd.Type)
			}
		}
	}
}

func (s *Scheduler) executeScan() {
	start := time.Now()
	if err := s.scanFn(); err != nil {
		slog.Error("scan failed", "error", err, "duration_ms", time.Since(start).Milliseconds())
		return
	}
	slog.Info("scan completed", "duration_ms", time.Since(start).Milliseconds())
}
