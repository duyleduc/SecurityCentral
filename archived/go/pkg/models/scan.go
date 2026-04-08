package models

import "time"

// ScanType identifies the type of scan performed.
type ScanType string

const (
	ScanTypeDependency    ScanType = "dependency"
	ScanTypeSecret        ScanType = "secret"
	ScanTypeInfra         ScanType = "infrastructure"
	ScanTypeCertificate   ScanType = "certificate"
)

// ScanStatus represents the current state of a scan.
type ScanStatus string

const (
	ScanStatusQueued    ScanStatus = "queued"
	ScanStatusRunning   ScanStatus = "running"
	ScanStatusCompleted ScanStatus = "completed"
	ScanStatusFailed    ScanStatus = "failed"
)

// ScanResult is the output of a completed scan, submitted to the platform.
type ScanResult struct {
	ScanID     string    `json:"scan_id"`
	ScanType   ScanType  `json:"scan_type"`
	Status     ScanStatus `json:"status"`
	Findings   []Finding `json:"findings"`
	DurationMs int64     `json:"duration_ms"`
	Error      string    `json:"error,omitempty"`
	CompletedAt time.Time `json:"completed_at"`
}
