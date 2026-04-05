package agent

import (
	"log/slog"
	"time"
)

// ScanFunc is the function signature for running a scan.
type ScanFunc func() error

// Scheduler manages periodic scan execution, on-demand triggers, and
// runtime config updates from the server.
type Scheduler struct {
	interval  time.Duration
	onStartup bool
	scanFn    ScanFunc
	cmdCh     <-chan Command
	configCh  <-chan ConfigUpdate
}

// NewScheduler creates a scan scheduler with default config.
func NewScheduler(scanFn ScanFunc, cmdCh <-chan Command, configCh <-chan ConfigUpdate) *Scheduler {
	defaults := DefaultServerConfig()
	return &Scheduler{
		interval:  defaults.ScanInterval(),
		onStartup: defaults.Scan.OnStartup,
		scanFn:    scanFn,
		cmdCh:     cmdCh,
		configCh:  configCh,
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
			default:
				slog.Warn("unknown command type", "type", cmd.Type)
			}

		case update := <-s.configCh:
			newInterval := update.Config.ScanInterval()
			if newInterval != s.interval {
				slog.Info("scan interval changed", "old", s.interval, "new", newInterval)
				s.interval = newInterval
				ticker.Reset(s.interval)
			}
			s.onStartup = update.Config.Scan.OnStartup
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
