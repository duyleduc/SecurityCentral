// Package platform provides the HTTPS client for communicating with the SecurityCentral Platform API.
package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/security-central/security-central/pkg/models"
)

const (
	maxRetries     = 5
	initialBackoff = 1 * time.Second
	maxBackoff     = 30 * time.Second
)

// Client communicates with the SecurityCentral Platform API.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// New creates a new platform client.
func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FindingsPayload is the request body for POST /v1/agents/findings.
type FindingsPayload struct {
	AgentID     string           `json:"agent_id"`
	ScanType    string           `json:"scan_type"`
	StartedAt   string           `json:"started_at"`
	CompletedAt string           `json:"completed_at"`
	Findings    []FindingPayload `json:"findings"`
}

// FindingPayload is a single finding in the submission batch.
type FindingPayload struct {
	Type        string         `json:"type"`
	Severity    string         `json:"severity"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	CveID       string         `json:"cve_id,omitempty"`
	CvssScore   float64        `json:"cvss_score,omitempty"`
	CvssVector  string         `json:"cvss_vector,omitempty"`
	Detail      map[string]any `json:"detail,omitempty"`
	Remediation string         `json:"remediation,omitempty"`
	AutoFixable bool           `json:"auto_fixable"`
}

// UploadResponse is the platform's response to a findings submission.
type UploadResponse struct {
	Data struct {
		ScanID           string `json:"scanId"`
		FindingsCreated  int    `json:"findingsCreated"`
		FindingsUpdated  int    `json:"findingsUpdated"`
		FindingsResolved int    `json:"findingsResolved"`
	} `json:"data"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// SubmitFindings uploads scan findings to the platform with retry logic.
func (c *Client) SubmitFindings(findings []models.Finding, scanType string, startedAt, completedAt time.Time) (*UploadResponse, error) {
	payload := FindingsPayload{
		AgentID:     "sc-scan-cli",
		ScanType:    scanType,
		StartedAt:   startedAt.Format(time.RFC3339),
		CompletedAt: completedAt.Format(time.RFC3339),
		Findings:    toPayloadFindings(findings),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal findings payload: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoff := BackoffDuration(attempt)
			slog.Info("retrying upload", "attempt", attempt+1, "backoff", backoff)
			time.Sleep(backoff)
		}

		resp, err := c.doRequest("POST", "/v1/agents/findings", body)
		if err != nil {
			lastErr = err
			slog.Warn("upload request failed", "attempt", attempt+1, "error", err)
			continue
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK {
			var result UploadResponse
			if err := json.Unmarshal(respBody, &result); err != nil {
				return nil, fmt.Errorf("parse upload response: %w", err)
			}
			return &result, nil
		}

		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return nil, fmt.Errorf("authentication failed (HTTP %d): check API key", resp.StatusCode)
		}

		// Retry on 5xx and 429
		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
			lastErr = fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
			continue
		}

		// Non-retryable client error
		return nil, fmt.Errorf("upload failed (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	return nil, fmt.Errorf("upload failed after %d attempts: %w", maxRetries, lastErr)
}

func (c *Client) doRequest(method, path string, body []byte) (*http.Response, error) {
	url := c.baseURL + path
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("User-Agent", "SecurityCentral-CLI/1.0")

	return c.httpClient.Do(req)
}

func toPayloadFindings(findings []models.Finding) []FindingPayload {
	result := make([]FindingPayload, 0, len(findings))
	for _, f := range findings {
		sourceType := "unknown"
		switch f.Source {
		case models.SourceDependency:
			sourceType = "package_vulnerability"
		case models.SourceSecret:
			sourceType = "secret"
		}

		result = append(result, FindingPayload{
			Type:        sourceType,
			Severity:    string(f.Severity),
			Title:       f.Title,
			Description: f.Description,
			CveID:       f.CveID,
			CvssScore:   f.CvssScore,
			CvssVector:  f.CvssVector,
			Detail:      f.Detail,
			Remediation: f.Remediation,
			AutoFixable: f.AutoFixable,
		})
	}
	return result
}

// BackoffDuration calculates exponential backoff for the given attempt number.
func BackoffDuration(attempt int) time.Duration {
	d := initialBackoff * time.Duration(math.Pow(2, float64(attempt-1)))
	if d > maxBackoff {
		d = maxBackoff
	}
	return d
}
