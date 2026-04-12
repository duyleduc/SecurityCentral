// Package collector defines the pluggable collector interface and registry.
// Each metric domain (CPU, memory, disk, network) implements Collector.
// The scheduler groups collectors by cadence and ticks each group independently.
package collector

import "time"

// Cadence defines how often a collector runs.
type Cadence int

const (
	CadenceFast     Cadence = iota // 1s sampling, aggregated to 60s in ring buffer
	CadenceStandard                // 60s direct collection
	CadenceSlow                    // 5 min
	CadenceScan                    // 1 hour (security posture)
	CadenceDaily                   // 24 hours
)

// CadenceInterval returns the tick duration for a cadence level.
func CadenceInterval(c Cadence) time.Duration {
	switch c {
	case CadenceFast:
		return 1 * time.Second
	case CadenceStandard:
		return 60 * time.Second
	case CadenceSlow:
		return 5 * time.Minute
	case CadenceScan:
		return 1 * time.Hour
	case CadenceDaily:
		return 24 * time.Hour
	default:
		return 60 * time.Second
	}
}

// Snapshot is a single collection result.
type Snapshot struct {
	Key  string      // collector name, e.g. "cpu", "disk"
	Data interface{} // typed struct per collector
	At   time.Time
}

// Collector is the interface every metric domain implements.
type Collector interface {
	// Name returns a unique identifier (e.g., "cpu", "disk").
	Name() string

	// Cadence returns how often this collector should run.
	Cadence() Cadence

	// Enabled probes the host and returns true if this collector
	// can run. Called once at startup.
	Enabled() bool

	// Init is called once before the first Collect().
	// Use for baseline readings (e.g., previous network byte counters).
	Init() error

	// Collect gathers current metrics.
	// Returns nil Snapshot if nothing to report.
	Collect() (*Snapshot, error)
}

// Registry holds all registered collectors.
type Registry struct {
	collectors []Collector
}

func NewRegistry() *Registry {
	return &Registry{}
}

// Register adds a collector to the registry.
func (r *Registry) Register(c Collector) {
	r.collectors = append(r.collectors, c)
}

// Enabled returns only collectors whose Enabled() returns true.
func (r *Registry) Enabled() []Collector {
	var out []Collector
	for _, c := range r.collectors {
		if c.Enabled() {
			out = append(out, c)
		}
	}
	return out
}

// ByCadence groups enabled collectors by their cadence.
func (r *Registry) ByCadence() map[Cadence][]Collector {
	groups := make(map[Cadence][]Collector)
	for _, c := range r.collectors {
		if c.Enabled() {
			groups[c.Cadence()] = append(groups[c.Cadence()], c)
		}
	}
	return groups
}
