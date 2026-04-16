package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type RegisterRequest struct {
	Token        string `json:"token"`
	Hostname     string `json:"hostname"`
	OSFamily     string `json:"osFamily,omitempty"`
	OSVersion    string `json:"osVersion,omitempty"`
	AgentVersion string `json:"agentVersion,omitempty"`
}

type RegisterResponse struct {
	ServerID string `json:"serverId"`
	AgentID  string `json:"agentId"`
	APIKey   string `json:"apiKey"`
	OrgID    string `json:"orgId"`
}

type HeartbeatRequest struct {
	AgentID string        `json:"agentId"`
	Urgent  bool          `json:"urgent"`
	Alerts  []Alert       `json:"alerts"`
	Metrics MetricsData   `json:"metrics"`
	System  *SystemData   `json:"system,omitempty"`
}

type Alert struct {
	Type      string  `json:"type"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
	Since     string  `json:"since,omitempty"`
}

type MetricsData struct {
	CPU     CPUMetrics      `json:"cpu"`
	RAM     RAMMetrics      `json:"ram"`
	Disk    DiskMetrics     `json:"disk"`
	Load    LoadMetrics     `json:"load"`
	Network NetworkMetrics  `json:"network"`
	Process *ProcessMetrics `json:"process,omitempty"`
	Service *ServiceMetrics `json:"service,omitempty"`
	Docker  *DockerMetrics  `json:"docker,omitempty"`
}

type DockerMetrics struct {
	Running    int             `json:"running"`
	Stopped    int             `json:"stopped"`
	Containers []ContainerData `json:"containers"`
}

type ContainerData struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Image    string  `json:"image"`
	State    string  `json:"state"`
	CPU      float64 `json:"cpu"`
	Memory   float64 `json:"memory"`
	Restarts int     `json:"restarts"`
}

type ProcessMetrics struct {
	Total    int           `json:"total"`
	Zombies  int           `json:"zombies"`
	OOMKills int           `json:"oomKills"`
	Top      []ProcessInfo `json:"top"`
}

type ProcessInfo struct {
	PID  int32   `json:"pid"`
	Name string  `json:"name"`
	User string  `json:"user"`
	CPU  float64 `json:"cpu"`
	RAM  float64 `json:"ram"`
}

type ServiceMetrics struct {
	FailedUnits []string `json:"failedUnits"`
}

// BruteForceData is the brute force analysis sent with security posture.
type BruteForceData struct {
	SSHVelocity     int               `json:"sshVelocity"`
	SSHUniqueIPs    int               `json:"sshUniqueIps"`
	SSHTopAttackers []IPCountEntry    `json:"sshTopAttackers"`
	SSHCompromise   []CompromiseEntry `json:"sshCompromise"`
	HTTPVelocity    int               `json:"httpVelocity"`
	HTTPUniqueIPs   int               `json:"httpUniqueIps"`
	IsActiveAttack  bool              `json:"isActiveAttack"`
	IsDistributed   bool              `json:"isDistributed"`
	HasCompromise   bool              `json:"hasCompromise"`
}

type IPCountEntry struct {
	IP    string `json:"ip"`
	Count int    `json:"count"`
}

type CompromiseEntry struct {
	IP             string `json:"ip"`
	FailuresBefore int    `json:"failuresBefore"`
	SuccessUser    string `json:"successUser"`
	SuccessAt      string `json:"successAt"`
}

// SecurityPostureRequest is sent to POST /v1/agents/security-posture.
type SecurityPostureRequest struct {
	AgentID        string            `json:"agentId"`
	CollectedAt    string            `json:"collectedAt"`
	ListeningPorts []PortEntry       `json:"listeningPorts"`
	SSHConfig      SSHConfig         `json:"sshConfig"`
	Firewall       FWInfo            `json:"firewall"`
	LoggedInUsers  []SessionInfo     `json:"loggedInUsers"`
	SSHFailures    int               `json:"sshFailures"`
	ShellUsers     []string          `json:"shellUsers"`
	PendingReboot  bool              `json:"pendingReboot"`
	OpenFDs        FDEntry           `json:"openFDs"`
	AuditResults   []AuditResultEntry `json:"auditResults,omitempty"`
	BruteForce     *BruteForceData    `json:"bruteForce,omitempty"`
}

type AuditResultEntry struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Title    string `json:"title"`
	Status   string `json:"status"`   // pass, fail, warn
	Severity string `json:"severity"` // critical, high, medium, low
	Detail   string `json:"detail"`
}

type PortEntry struct {
	Port    uint32 `json:"port"`
	Proto   string `json:"proto"`
	Process string `json:"process"`
	Bind    string `json:"bind"`
}

type SSHConfig struct {
	RootLogin      string `json:"rootLogin"`
	PasswordAuth   string `json:"passwordAuth"`
	Port           int    `json:"port"`
	PermitEmptyPwd string `json:"permitEmptyPwd"`
}

type FWInfo struct {
	Active bool   `json:"active"`
	Type   string `json:"type"`
}

type SessionInfo struct {
	User  string `json:"user"`
	From  string `json:"from"`
	Since string `json:"since"`
}

type FDEntry struct {
	Allocated int `json:"allocated"`
	Max       int `json:"max"`
}

// PackageInventoryRequest is sent to POST /v1/agents/package-inventory.
type PackageInventoryRequest struct {
	AgentID                string           `json:"agentId"`
	CollectedAt            string           `json:"collectedAt"`
	OSFamily               string           `json:"osFamily"`
	Packages               []PkgEntry       `json:"packages"`
	BinaryVersions         []BinaryVer      `json:"binaryVersions"`
	PendingSecurityUpdates int              `json:"pendingSecurityUpdates"`
	HeldPackages           []string         `json:"heldPackages"`
	KernelRunning          string           `json:"kernelRunning"`
	KernelInstalled        string           `json:"kernelInstalled"`
	UnattendedUpgrades     bool             `json:"unattendedUpgrades"`
	PackageHash            string           `json:"packageHash"`
}

type PkgEntry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Arch    string `json:"arch,omitempty"`
}

type BinaryVer struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type CPUMetrics struct {
	Avg    float64 `json:"avg"`
	Max    float64 `json:"max"`
	IOWait float64 `json:"ioWait"`
}

type RAMMetrics struct {
	Avg         float64 `json:"avg"`
	Max         float64 `json:"max"`
	SwapUsedPct float64 `json:"swapUsedPct"`
}

type DiskMetrics struct {
	Usage        float64 `json:"usage"`
	IOErrors     int     `json:"ioErrors"`
	ReadBps      uint64  `json:"readBps"`
	WriteBps     uint64  `json:"writeBps"`
	IOUtilPct    float64 `json:"ioUtilPct"`
}

type LoadMetrics struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}

type NetworkMetrics struct {
	RxBytesPerSec uint64         `json:"rxBytesPerSec"`
	TxBytesPerSec uint64         `json:"txBytesPerSec"`
	Errors        uint64         `json:"errors"`
	Drops         uint64         `json:"drops"`
	Interfaces    []IfaceMetric  `json:"interfaces,omitempty"`
}

type IfaceMetric struct {
	Name    string `json:"name"`
	RxBytes uint64 `json:"rxBytes"`
	TxBytes uint64 `json:"txBytes"`
	Errors  uint64 `json:"errors"`
	Drops   uint64 `json:"drops"`
}

type SystemData struct {
	Hostname     string   `json:"hostname,omitempty"`
	OS           string   `json:"os,omitempty"`
	OSVersion    string   `json:"osVersion,omitempty"`
	Kernel       string   `json:"kernel,omitempty"`
	Arch         string   `json:"arch,omitempty"`
	AgentVersion string   `json:"agentVersion,omitempty"`
	CPUCores     int      `json:"cpuCores,omitempty"`
	CPUModel     string   `json:"cpuModel,omitempty"`
	TotalRAMMB   int64    `json:"totalRamMb,omitempty"`
	TotalDiskGB  int64    `json:"totalDiskGb,omitempty"`
	IPAddresses  []string `json:"ipAddresses,omitempty"`
}

type HeartbeatResponse struct {
	Commands []interface{}          `json:"commands"`
	Config   map[string]interface{} `json:"config"`
}

type APIEnvelope struct {
	Data   json.RawMessage `json:"data"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

func (c *Client) Register(req RegisterRequest) (*RegisterResponse, error) {
	var resp RegisterResponse
	if err := c.post("/v1/agents/register", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) SendHeartbeat(req HeartbeatRequest) (*HeartbeatResponse, error) {
	var resp HeartbeatResponse
	if err := c.post("/v1/agents/heartbeat", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) SendSecurityPosture(req SecurityPostureRequest) error {
	return c.post("/v1/agents/security-posture", req, nil)
}

func (c *Client) SendPackageInventory(req PackageInventoryRequest) error {
	return c.post("/v1/agents/package-inventory", req, nil)
}

// SuspiciousProcessRequest is sent to POST /v1/agents/suspicious-processes.
type SuspiciousProcessRequest struct {
	AgentID     string                 `json:"agentId"`
	CollectedAt string                 `json:"collectedAt"`
	Detections  []SuspiciousDetEntry   `json:"detections"`
}

type SuspiciousDetEntry struct {
	PID        int32   `json:"pid"`
	Name       string  `json:"name"`
	User       string  `json:"user"`
	CPU        float64 `json:"cpu"`
	RAM        float64 `json:"ram"`
	Cmdline    string  `json:"cmdline"`
	ParentName string  `json:"parentName"`
	Reason     string  `json:"reason"` // known_miner | high_cpu_sustained | reverse_shell | suspicious_path
	HasNetwork bool    `json:"hasNetwork"`
	Duration   int     `json:"duration"`
}

func (c *Client) SendSuspiciousProcesses(req SuspiciousProcessRequest) error {
	return c.post("/v1/agents/suspicious-processes", req, nil)
}

func (c *Client) post(path string, body interface{}, result interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-Agent-Key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var envelope APIEnvelope
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if len(envelope.Errors) > 0 {
		return fmt.Errorf("API error: %s - %s", envelope.Errors[0].Code, envelope.Errors[0].Message)
	}

	if result != nil && envelope.Data != nil {
		if err := json.Unmarshal(envelope.Data, result); err != nil {
			return fmt.Errorf("parse data: %w", err)
		}
	}

	return nil
}
