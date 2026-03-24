// Package models contains shared types used across all SecurityCentral Go components.
package models

import "time"

// Severity represents the severity level of a finding.
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
	SeverityInfo     Severity = "info"
)

// FindingSource identifies which scanner produced the finding.
type FindingSource string

const (
	SourceDependency    FindingSource = "dependency"
	SourceSecret        FindingSource = "secret"
	SourceInfra         FindingSource = "infrastructure"
	SourceCertificate   FindingSource = "certificate"
)

// Finding represents a single security finding from any scanner.
type Finding struct {
	ID          string            `json:"id"`
	Source      FindingSource     `json:"source"`
	Severity    Severity          `json:"severity"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	CveID       string            `json:"cve_id,omitempty"`
	CvssScore   float64           `json:"cvss_score,omitempty"`
	CvssVector  string            `json:"cvss_vector,omitempty"`
	Remediation string            `json:"remediation,omitempty"`
	AutoFixable bool              `json:"auto_fixable"`
	Detail      map[string]any    `json:"detail,omitempty"`
	FirstSeenAt time.Time         `json:"first_seen_at"`
}
