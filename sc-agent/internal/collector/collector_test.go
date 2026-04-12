package collector

import (
	"testing"
	"time"
)

// stubCollector implements Collector for testing.
type stubCollector struct {
	name    string
	cadence Cadence
	enabled bool
	initErr error
	data    interface{}
	collErr error
}

func (s *stubCollector) Name() string     { return s.name }
func (s *stubCollector) Cadence() Cadence { return s.cadence }
func (s *stubCollector) Enabled() bool    { return s.enabled }
func (s *stubCollector) Init() error      { return s.initErr }
func (s *stubCollector) Collect() (*Snapshot, error) {
	if s.collErr != nil {
		return nil, s.collErr
	}
	return &Snapshot{Key: s.name, Data: s.data, At: time.Now()}, nil
}

func TestRegistryEnabled(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&stubCollector{name: "a", enabled: true})
	reg.Register(&stubCollector{name: "b", enabled: false})
	reg.Register(&stubCollector{name: "c", enabled: true})

	enabled := reg.Enabled()
	if len(enabled) != 2 {
		t.Fatalf("expected 2 enabled collectors, got %d", len(enabled))
	}
	if enabled[0].Name() != "a" || enabled[1].Name() != "c" {
		t.Fatalf("wrong collectors: %s, %s", enabled[0].Name(), enabled[1].Name())
	}
}

func TestRegistryByCadence(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&stubCollector{name: "cpu", cadence: CadenceFast, enabled: true})
	reg.Register(&stubCollector{name: "mem", cadence: CadenceFast, enabled: true})
	reg.Register(&stubCollector{name: "disk", cadence: CadenceStandard, enabled: true})
	reg.Register(&stubCollector{name: "off", cadence: CadenceFast, enabled: false})

	groups := reg.ByCadence()
	if len(groups[CadenceFast]) != 2 {
		t.Fatalf("expected 2 fast collectors, got %d", len(groups[CadenceFast]))
	}
	if len(groups[CadenceStandard]) != 1 {
		t.Fatalf("expected 1 standard collector, got %d", len(groups[CadenceStandard]))
	}
}

func TestCadenceInterval(t *testing.T) {
	tests := []struct {
		cadence  Cadence
		expected time.Duration
	}{
		{CadenceFast, 1 * time.Second},
		{CadenceStandard, 60 * time.Second},
		{CadenceSlow, 5 * time.Minute},
		{CadenceScan, 1 * time.Hour},
		{CadenceDaily, 24 * time.Hour},
	}

	for _, tt := range tests {
		got := CadenceInterval(tt.cadence)
		if got != tt.expected {
			t.Errorf("CadenceInterval(%d) = %v, want %v", tt.cadence, got, tt.expected)
		}
	}
}
