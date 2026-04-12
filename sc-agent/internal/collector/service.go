package collector

import (
	"os/exec"
	"strings"
	"time"
)

// ServiceData is the snapshot data for the systemd service collector.
type ServiceData struct {
	FailedUnits []string
}

type serviceCollector struct{}

func NewService() Collector {
	return &serviceCollector{}
}

func (c *serviceCollector) Name() string     { return "service" }
func (c *serviceCollector) Cadence() Cadence { return CadenceStandard }

// Enabled returns true if systemctl is available.
func (c *serviceCollector) Enabled() bool {
	_, err := exec.LookPath("systemctl")
	return err == nil
}

func (c *serviceCollector) Init() error { return nil }

func (c *serviceCollector) Collect() (*Snapshot, error) {
	var d ServiceData

	out, err := exec.Command("systemctl", "list-units", "--state=failed", "--no-legend", "--plain").Output()
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			// First field is the unit name.
			parts := strings.Fields(line)
			if len(parts) > 0 {
				d.FailedUnits = append(d.FailedUnits, parts[0])
			}
		}
	}

	return &Snapshot{Key: "service", Data: d, At: time.Now()}, nil
}
