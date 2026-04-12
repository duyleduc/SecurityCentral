package collector

import (
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// DockerData is the snapshot data for the Docker collector.
type DockerData struct {
	Running    int
	Stopped    int
	Containers []ContainerInfo
}

// ContainerInfo holds per-container metadata and resource usage.
type ContainerInfo struct {
	ID       string
	Name     string
	Image    string
	State    string  // running, exited, restarting, etc.
	CPU      float64 // percent
	Memory   float64 // percent
	Restarts int
}

type dockerCollector struct{}

func NewDocker() Collector {
	return &dockerCollector{}
}

func (c *dockerCollector) Name() string     { return "docker" }
func (c *dockerCollector) Cadence() Cadence { return CadenceStandard }

// Enabled returns true only if docker binary exists and the daemon is running.
func (c *dockerCollector) Enabled() bool {
	if _, err := exec.LookPath("docker"); err != nil {
		return false
	}
	out, err := exec.Command("docker", "info", "--format", "{{.ServerVersion}}").Output()
	return err == nil && strings.TrimSpace(string(out)) != ""
}

func (c *dockerCollector) Init() error { return nil }

func (c *dockerCollector) Collect() (*Snapshot, error) {
	var d DockerData

	containers := listContainers()
	stats := collectStats()

	for _, ctr := range containers {
		ci := ContainerInfo{
			ID:       ctr.id,
			Name:     ctr.name,
			Image:    ctr.image,
			State:    ctr.state,
			Restarts: ctr.restarts,
		}

		if s, ok := stats[ctr.id]; ok {
			ci.CPU = s.cpu
			ci.Memory = s.mem
		}

		switch ctr.state {
		case "running":
			d.Running++
		default:
			d.Stopped++
		}

		d.Containers = append(d.Containers, ci)
	}

	return &Snapshot{Key: "docker", Data: d, At: time.Now()}, nil
}

// --- internal helpers ---

type rawContainer struct {
	id       string
	name     string
	image    string
	state    string
	restarts int
}

// dockerPSJSON is the JSON format from `docker ps -a --format json`.
type dockerPSJSON struct {
	ID      string `json:"ID"`
	Names   string `json:"Names"`
	Image   string `json:"Image"`
	State   string `json:"State"`
	Status  string `json:"Status"`
}

func listContainers() []rawContainer {
	out, err := exec.Command("docker", "ps", "-a", "--format", "json", "--no-trunc").Output()
	if err != nil {
		return nil
	}

	var containers []rawContainer
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var j dockerPSJSON
		if err := json.Unmarshal([]byte(line), &j); err != nil {
			continue
		}

		restarts := getRestartCount(j.ID)

		containers = append(containers, rawContainer{
			id:       j.ID[:12],
			name:     strings.TrimPrefix(j.Names, "/"),
			image:    j.Image,
			state:    strings.ToLower(j.State),
			restarts: restarts,
		})
	}
	return containers
}

func getRestartCount(id string) int {
	out, err := exec.Command("docker", "inspect", "--format", "{{.RestartCount}}", id).Output()
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n
}

type statResult struct {
	cpu float64
	mem float64
}

// dockerStatsJSON is the JSON format from `docker stats --no-stream --format json`.
type dockerStatsJSON struct {
	Container string `json:"Container"`
	CPUPerc   string `json:"CPUPerc"`
	MemPerc   string `json:"MemPerc"`
}

func collectStats() map[string]statResult {
	out, err := exec.Command("docker", "stats", "--no-stream", "--format", "json").Output()
	if err != nil {
		return nil
	}

	results := make(map[string]statResult)
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var j dockerStatsJSON
		if err := json.Unmarshal([]byte(line), &j); err != nil {
			continue
		}

		cpu := parsePercent(j.CPUPerc)
		mem := parsePercent(j.MemPerc)

		id := j.Container
		if len(id) > 12 {
			id = id[:12]
		}
		results[id] = statResult{cpu: cpu, mem: mem}
	}
	return results
}

func parsePercent(s string) float64 {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, "%")
	v, _ := strconv.ParseFloat(s, 64)
	return v
}
