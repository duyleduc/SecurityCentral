// Package output provides formatters for scan results.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"

	"github.com/security-central/security-central/pkg/models"
)

// Format writes findings in the specified format to the writer.
func Format(w io.Writer, format string, findings []models.Finding) error {
	switch strings.ToLower(format) {
	case "json":
		return formatJSON(w, findings)
	case "sarif":
		return formatSARIF(w, findings)
	default:
		return formatTable(w, findings)
	}
}

// --- Table format ---

func formatTable(w io.Writer, findings []models.Finding) error {
	if len(findings) == 0 {
		fmt.Fprintln(w, "No findings detected.")
		return nil
	}

	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "SEVERITY\tTITLE\tCVE\tSOURCE\tAUTO-FIX")

	for _, f := range findings {
		fix := "no"
		if f.AutoFixable {
			fix = "yes"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", f.Severity, truncate(f.Title, 60), f.CveID, f.Source, fix)
	}

	return tw.Flush()
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}

// --- JSON format ---

func formatJSON(w io.Writer, findings []models.Finding) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(findings)
}

// --- SARIF format (GitHub Code Scanning compatible) ---

type sarifReport struct {
	Schema  string     `json:"$schema"`
	Version string     `json:"version"`
	Runs    []sarifRun `json:"runs"`
}

type sarifRun struct {
	Tool    sarifTool     `json:"tool"`
	Results []sarifResult `json:"results"`
}

type sarifTool struct {
	Driver sarifDriver `json:"driver"`
}

type sarifDriver struct {
	Name    string      `json:"name"`
	Version string      `json:"version"`
	Rules   []sarifRule `json:"rules"`
}

type sarifRule struct {
	ID               string          `json:"id"`
	ShortDescription sarifMessage    `json:"shortDescription"`
	DefaultConfig    sarifRuleConfig `json:"defaultConfiguration"`
}

type sarifRuleConfig struct {
	Level string `json:"level"`
}

type sarifResult struct {
	RuleID    string         `json:"ruleId"`
	Message   sarifMessage   `json:"message"`
	Level     string         `json:"level"`
	Locations []sarifLocation `json:"locations,omitempty"`
}

type sarifMessage struct {
	Text string `json:"text"`
}

type sarifLocation struct {
	PhysicalLocation sarifPhysicalLocation `json:"physicalLocation"`
}

type sarifPhysicalLocation struct {
	ArtifactLocation sarifArtifactLocation `json:"artifactLocation"`
	Region           *sarifRegion          `json:"region,omitempty"`
}

type sarifArtifactLocation struct {
	URI string `json:"uri"`
}

type sarifRegion struct {
	StartLine int `json:"startLine"`
}

func formatSARIF(w io.Writer, findings []models.Finding) error {
	rules := make([]sarifRule, 0, len(findings))
	results := make([]sarifResult, 0, len(findings))

	ruleSet := map[string]bool{}

	for _, f := range findings {
		ruleID := f.CveID
		if ruleID == "" {
			ruleID = fmt.Sprintf("SC-%s", f.Source)
		}

		if !ruleSet[ruleID] {
			rules = append(rules, sarifRule{
				ID:               ruleID,
				ShortDescription: sarifMessage{Text: f.Title},
				DefaultConfig:    sarifRuleConfig{Level: sarifLevel(f.Severity)},
			})
			ruleSet[ruleID] = true
		}

		r := sarifResult{
			RuleID:  ruleID,
			Message: sarifMessage{Text: f.Description},
			Level:   sarifLevel(f.Severity),
		}

		// Add location if available in detail
		if filePath, ok := f.Detail["file"].(string); ok {
			loc := sarifLocation{
				PhysicalLocation: sarifPhysicalLocation{
					ArtifactLocation: sarifArtifactLocation{URI: filePath},
				},
			}
			if line, ok := f.Detail["line"].(float64); ok {
				loc.PhysicalLocation.Region = &sarifRegion{StartLine: int(line)}
			}
			r.Locations = append(r.Locations, loc)
		}

		results = append(results, r)
	}

	report := sarifReport{
		Schema:  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
		Version: "2.1.0",
		Runs: []sarifRun{{
			Tool: sarifTool{
				Driver: sarifDriver{
					Name:    "SecurityCentral",
					Version: "1.0.0",
					Rules:   rules,
				},
			},
			Results: results,
		}},
	}

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(report)
}

func sarifLevel(sev models.Severity) string {
	switch sev {
	case models.SeverityCritical, models.SeverityHigh:
		return "error"
	case models.SeverityMedium:
		return "warning"
	default:
		return "note"
	}
}

// ExitCode returns the appropriate exit code based on findings and fail-on threshold.
// 0: clean or below threshold, 1: findings at or above threshold, 2: scan error
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
