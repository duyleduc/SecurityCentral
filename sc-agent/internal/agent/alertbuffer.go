package agent

import (
	"sync"

	"github.com/securitycentral/sc-agent/internal/platform"
)

// AlertBuffer collects alerts from threshold checks.
type AlertBuffer struct {
	mu     sync.Mutex
	alerts []platform.Alert
}

func NewAlertBuffer() *AlertBuffer {
	return &AlertBuffer{}
}

func (ab *AlertBuffer) Push(alerts []platform.Alert) {
	if len(alerts) == 0 {
		return
	}
	ab.mu.Lock()
	defer ab.mu.Unlock()
	ab.alerts = append(ab.alerts, alerts...)
}

func (ab *AlertBuffer) Drain() []platform.Alert {
	ab.mu.Lock()
	defer ab.mu.Unlock()
	out := ab.alerts
	ab.alerts = nil
	return out
}

func (ab *AlertBuffer) HasAlerts() bool {
	ab.mu.Lock()
	defer ab.mu.Unlock()
	return len(ab.alerts) > 0
}
