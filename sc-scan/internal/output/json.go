// Package output provides JSON output for platform ingestion.
package output

import (
	"encoding/json"
	"io"

	"github.com/securitycentral/sc-scan/pkg/models"
)

// WriteJSON encodes a ScanResult as JSON to the given writer.
func WriteJSON(w io.Writer, result models.ScanResult) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(result)
}

// ExitCode returns the appropriate exit code based on findings and fail-on threshold.
// 0: clean or below threshold, 1: findings at or above threshold, 2: scan error.
func ExitCode(findings []models.Finding, failOn string) int {
	if failOn == "" {
		return 0
	}

	threshold := severityRank(models.Severity(failOn))
	for _, f := range findings {
		if severityRank(f.Severity) <= threshold {
			return 1
		}
	}
	return 0
}

func severityRank(s models.Severity) int {
	switch s {
	case models.SeverityCritical:
		return 0
	case models.SeverityHigh:
		return 1
	case models.SeverityMedium:
		return 2
	case models.SeverityLow:
		return 3
	case models.SeverityInfo:
		return 4
	default:
		return 5
	}
}
