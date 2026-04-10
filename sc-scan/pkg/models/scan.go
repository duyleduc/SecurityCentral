package models

// ScanResult is the top-level JSON output for platform ingestion.
type ScanResult struct {
	ScanType     string    `json:"scan_type"`
	Findings     []Finding `json:"findings"`
	Duration     int64     `json:"duration_ms"`
	FilesScanned int       `json:"files_scanned"`
	Error        string    `json:"error,omitempty"`
}
