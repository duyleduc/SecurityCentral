package agent

import (
	"context"
	"time"

	"github.com/securitycentral/sc-agent/internal/collector"
	"github.com/securitycentral/sc-agent/internal/logging"
)

// Scheduler manages multi-cadence collection. Each cadence group gets its own
// goroutine that ticks at the group's interval and calls Collect() on all
// collectors in the group.
type Scheduler struct {
	registry *collector.Registry
	log      *logging.Logger
}

func NewScheduler(reg *collector.Registry, log *logging.Logger) *Scheduler {
	return &Scheduler{registry: reg, log: log}
}

// Run initializes all enabled collectors and starts a goroutine per cadence group.
// All results flow to the returned channel. The channel is closed when ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) <-chan collector.Snapshot {
	results := make(chan collector.Snapshot, 64)

	groups := s.registry.ByCadence()

	// Initialize all enabled collectors.
	for _, collectors := range groups {
		for _, c := range collectors {
			if err := c.Init(); err != nil {
				s.log.Warn("collector init failed", map[string]interface{}{
					"collector": c.Name(),
					"error":     err.Error(),
				})
			}
		}
	}

	// Start a goroutine per cadence group.
	for cadence, collectors := range groups {
		interval := collector.CadenceInterval(cadence)
		names := make([]string, len(collectors))
		for i, c := range collectors {
			names[i] = c.Name()
		}
		s.log.Info("starting collector group", map[string]interface{}{
			"interval":   interval.String(),
			"collectors": names,
		})
		go s.runGroup(ctx, interval, collectors, results)
	}

	// Close results channel when ctx is done.
	go func() {
		<-ctx.Done()
		// Drain briefly then close — goroutines will exit via ctx.Done().
		time.Sleep(100 * time.Millisecond)
		close(results)
	}()

	return results
}

func (s *Scheduler) runGroup(
	ctx context.Context,
	interval time.Duration,
	collectors []collector.Collector,
	results chan<- collector.Snapshot,
) {
	// Collect once immediately at startup.
	s.collectAll(ctx, collectors, results)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.collectAll(ctx, collectors, results)
		}
	}
}

func (s *Scheduler) collectAll(
	ctx context.Context,
	collectors []collector.Collector,
	results chan<- collector.Snapshot,
) {
	for _, c := range collectors {
		snap, err := c.Collect()
		if err != nil {
			s.log.Warn("collector failed", map[string]interface{}{
				"collector": c.Name(),
				"error":     err.Error(),
			})
			continue
		}
		if snap == nil {
			continue
		}

		select {
		case results <- *snap:
		case <-ctx.Done():
			return
		}
	}
}
