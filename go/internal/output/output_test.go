package output

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/security-central/security-central/pkg/models"
)

func sampleFindings() []models.Finding {
	return []models.Finding{
		{
			Source:      models.SourceDependency,
			Severity:    models.SeverityHigh,
			Title:       "CVE-2024-1234 in lodash@4.17.20",
			Description: "Prototype pollution in lodash",
			CveID:       "CVE-2024-1234",
			CvssScore:   7.4,
			AutoFixable: true,
		},
		{
			Source:      models.SourceSecret,
			Severity:    models.SeverityCritical,
			Title:       "AWS Access Key detected in config.js",
			Description: "Hardcoded AWS key",
			Detail:      map[string]any{"file": "config.js", "line": float64(42)},
		},
	}
}

func TestFormatTable(t *testing.T) {
	var buf bytes.Buffer
	err := Format(&buf, "table", sampleFindings())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	output := buf.String()
	if len(output) == 0 {
		t.Error("expected non-empty table output")
	}
	if !bytes.Contains(buf.Bytes(), []byte("CVE-2024-1234")) {
		t.Error("expected table to contain CVE ID")
	}
}

func TestFormatTableEmpty(t *testing.T) {
	var buf bytes.Buffer
	err := Format(&buf, "table", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("No findings")) {
		t.Error("expected 'No findings' message for empty results")
	}
}

func TestFormatJSON(t *testing.T) {
	var buf bytes.Buffer
	err := Format(&buf, "json", sampleFindings())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed []models.Finding
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(parsed) != 2 {
		t.Errorf("expected 2 findings, got %d", len(parsed))
	}
}

func TestFormatSARIF(t *testing.T) {
	var buf bytes.Buffer
	err := Format(&buf, "sarif", sampleFindings())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if parsed["version"] != "2.1.0" {
		t.Errorf("expected SARIF version 2.1.0, got %v", parsed["version"])
	}
}

func TestExitCode(t *testing.T) {
	findings := sampleFindings()

	tests := []struct {
		failOn string
		want   int
	}{
		{"", 0},           // no threshold
		{"critical", 1},   // has critical finding
		{"high", 1},       // has high finding
		{"info", 1},       // everything above info
	}

	for _, tt := range tests {
		t.Run("fail-on="+tt.failOn, func(t *testing.T) {
			got := ExitCode(findings, tt.failOn)
			if got != tt.want {
				t.Errorf("ExitCode(failOn=%q) = %d, want %d", tt.failOn, got, tt.want)
			}
		})
	}
}

func TestExitCodeClean(t *testing.T) {
	code := ExitCode(nil, "high")
	if code != 0 {
		t.Errorf("ExitCode(nil, high) = %d, want 0", code)
	}
}
