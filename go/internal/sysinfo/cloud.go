package sysinfo

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// CloudInfo contains cloud provider metadata detected via instance metadata
// services (IMDS). All fields are empty if not running on a cloud instance.
type CloudInfo struct {
	Provider     string `json:"provider,omitempty"`     // aws | gcp | azure
	Region       string `json:"region,omitempty"`       // e.g. us-east-1, us-central1-a
	InstanceID   string `json:"instanceId,omitempty"`   // provider-specific instance ID
	InstanceType string `json:"instanceType,omitempty"` // e.g. t3.micro, e2-medium
}

// DetectCloud probes cloud metadata endpoints to determine the cloud provider.
// Each probe has a 1-second timeout. Returns empty CloudInfo if not on a cloud.
func DetectCloud() CloudInfo {
	// Try AWS first (most common), then GCP, then Azure.
	if info := detectAWS(); info.Provider != "" {
		return info
	}
	if info := detectGCP(); info.Provider != "" {
		return info
	}
	if info := detectAzure(); info.Provider != "" {
		return info
	}
	return CloudInfo{}
}

func imdsClient() *http.Client {
	return &http.Client{Timeout: 1 * time.Second}
}

func imdsGet(url string, headers map[string]string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := imdsClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

// ---------------------------------------------------------------------------
// AWS EC2 IMDS v1 (IMDSv2 requires PUT token first — we try v1 for simplicity)
// ---------------------------------------------------------------------------

func detectAWS() CloudInfo {
	base := "http://169.254.169.254/latest/meta-data"

	instanceID, err := imdsGet(base+"/instance-id", nil)
	if err != nil || instanceID == "" {
		return CloudInfo{}
	}

	region, _ := imdsGet(base+"/placement/region", nil)
	instanceType, _ := imdsGet(base+"/instance-type", nil)

	return CloudInfo{
		Provider:     "aws",
		Region:       region,
		InstanceID:   instanceID,
		InstanceType: instanceType,
	}
}

// ---------------------------------------------------------------------------
// GCP Compute Engine metadata
// ---------------------------------------------------------------------------

func detectGCP() CloudInfo {
	headers := map[string]string{"Metadata-Flavor": "Google"}
	base := "http://metadata.google.internal/computeMetadata/v1"

	// instance/id is numeric on GCP
	instanceID, err := imdsGet(base+"/instance/id", headers)
	if err != nil || instanceID == "" {
		return CloudInfo{}
	}

	// zone returns "projects/123/zones/us-central1-a" — extract the zone
	zone, _ := imdsGet(base+"/instance/zone", headers)
	if idx := strings.LastIndex(zone, "/"); idx >= 0 {
		zone = zone[idx+1:]
	}

	machineType, _ := imdsGet(base+"/instance/machine-type", headers)
	if idx := strings.LastIndex(machineType, "/"); idx >= 0 {
		machineType = machineType[idx+1:]
	}

	return CloudInfo{
		Provider:     "gcp",
		Region:       zone,
		InstanceID:   instanceID,
		InstanceType: machineType,
	}
}

// ---------------------------------------------------------------------------
// Azure IMDS
// ---------------------------------------------------------------------------

type azureIMDS struct {
	Compute struct {
		Location     string `json:"location"`
		VMID         string `json:"vmId"`
		VMSize       string `json:"vmSize"`
		ResourceID   string `json:"resourceId"`
	} `json:"compute"`
}

func detectAzure() CloudInfo {
	headers := map[string]string{"Metadata": "true"}
	body, err := imdsGet("http://169.254.169.254/metadata/instance?api-version=2021-02-01", headers)
	if err != nil || body == "" {
		return CloudInfo{}
	}

	var meta azureIMDS
	if err := json.Unmarshal([]byte(body), &meta); err != nil {
		return CloudInfo{}
	}

	if meta.Compute.VMID == "" {
		return CloudInfo{}
	}

	return CloudInfo{
		Provider:     "azure",
		Region:       meta.Compute.Location,
		InstanceID:   meta.Compute.VMID,
		InstanceType: meta.Compute.VMSize,
	}
}
