package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/security-central/security-central/pkg/models"
)

func sampleFindings() []models.Finding {
	return []models.Finding{
		{
			Source:   models.SourceDependency,
			Severity: models.SeverityHigh,
			Title:    "CVE-2024-1234 in lodash@4.17.20",
			CveID:    "CVE-2024-1234",
			CvssScore: 7.4,
		},
	}
}

func TestSubmitFindings_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/agents/findings" {
			t.Errorf("expected /v1/agents/findings, got %s", r.URL.Path)
		}
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Errorf("expected X-API-Key=test-key, got %s", r.Header.Get("X-API-Key"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type=application/json")
		}

		// Verify payload
		var payload FindingsPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("failed to decode payload: %v", err)
		}
		if len(payload.Findings) != 1 {
			t.Errorf("expected 1 finding, got %d", len(payload.Findings))
		}
		if payload.Findings[0].Type != "package_vulnerability" {
			t.Errorf("expected type=package_vulnerability, got %s", payload.Findings[0].Type)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(UploadResponse{})
	}))
	defer server.Close()

	client := New(server.URL, "test-key")
	now := time.Now()
	resp, err := client.SubmitFindings(sampleFindings(), "code_dependencies", now.Add(-time.Minute), now)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
}

func TestSubmitFindings_AuthFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"errors":[{"code":"AUTH_INVALID_CREDENTIALS","message":"Invalid API key"}]}`))
	}))
	defer server.Close()

	client := New(server.URL, "bad-key")
	now := time.Now()
	_, err := client.SubmitFindings(sampleFindings(), "code_dependencies", now, now)

	if err == nil {
		t.Fatal("expected error for auth failure")
	}
	if got := err.Error(); got == "" {
		t.Error("expected non-empty error message")
	}
}

func TestSubmitFindings_RetryOn500(t *testing.T) {
	var attempts atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := attempts.Add(1)
		if count < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("server error"))
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(UploadResponse{})
	}))
	defer server.Close()

	// Use a client with short backoff for testing
	client := New(server.URL, "test-key")
	now := time.Now()
	resp, err := client.SubmitFindings(sampleFindings(), "code_dependencies", now, now)

	if err != nil {
		t.Fatalf("unexpected error after retries: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if got := attempts.Load(); got < 3 {
		t.Errorf("expected at least 3 attempts, got %d", got)
	}
}

func TestSubmitFindings_NonRetryableError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"errors":[{"code":"VALIDATION_ERROR","message":"bad request"}]}`))
	}))
	defer server.Close()

	client := New(server.URL, "test-key")
	now := time.Now()
	_, err := client.SubmitFindings(sampleFindings(), "code_dependencies", now, now)

	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestBackoffDuration(t *testing.T) {
	tests := []struct {
		attempt int
		min     time.Duration
		max     time.Duration
	}{
		{1, 1 * time.Second, 1 * time.Second},
		{2, 2 * time.Second, 2 * time.Second},
		{3, 4 * time.Second, 4 * time.Second},
		{4, 8 * time.Second, 8 * time.Second},
		{10, 30 * time.Second, 30 * time.Second}, // capped at maxBackoff
	}

	for _, tt := range tests {
		d := BackoffDuration(tt.attempt)
		if d < tt.min || d > tt.max {
			t.Errorf("BackoffDuration(%d) = %v, want [%v, %v]", tt.attempt, d, tt.min, tt.max)
		}
	}
}

func TestToPayloadFindings(t *testing.T) {
	findings := []models.Finding{
		{Source: models.SourceDependency, Severity: models.SeverityHigh, Title: "dep vuln"},
		{Source: models.SourceSecret, Severity: models.SeverityCritical, Title: "secret found"},
	}

	payloads := toPayloadFindings(findings)

	if len(payloads) != 2 {
		t.Fatalf("expected 2 payloads, got %d", len(payloads))
	}
	if payloads[0].Type != "package_vulnerability" {
		t.Errorf("expected type=package_vulnerability for dependency, got %s", payloads[0].Type)
	}
	if payloads[1].Type != "secret" {
		t.Errorf("expected type=secret for secret, got %s", payloads[1].Type)
	}
}
