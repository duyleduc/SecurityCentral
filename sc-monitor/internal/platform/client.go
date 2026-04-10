package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Endpoint struct {
	ID             string `json:"id"`
	OrgID          string `json:"orgId"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	Protocol       string `json:"protocol"`
	UptimeInterval int    `json:"uptimeInterval"`
	UptimeTimeout  int    `json:"uptimeTimeout"`
}

type HeartbeatResult struct {
	EndpointID string `json:"endpointId"`
	IsUp       bool   `json:"isUp"`
	StatusCode int    `json:"statusCode,omitempty"`
	ResponseMs int    `json:"responseMs"`
	Error      string `json:"error,omitempty"`
}

type Client struct {
	apiURL string
	apiKey string
	http   *http.Client
}

func New(apiURL, apiKey string) *Client {
	return &Client{
		apiURL: apiURL,
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

type apiEnvelope struct {
	Data json.RawMessage `json:"data"`
}

func (c *Client) GetDueEndpoints() ([]Endpoint, error) {
	req, err := http.NewRequest("GET", c.apiURL+"/v1/monitor/endpoints", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var env apiEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	var endpoints []Endpoint
	if err := json.Unmarshal(env.Data, &endpoints); err != nil {
		return nil, fmt.Errorf("decode endpoints: %w", err)
	}

	return endpoints, nil
}

func (c *Client) PostHeartbeats(results []HeartbeatResult) error {
	body := struct {
		Heartbeats []HeartbeatResult `json:"heartbeats"`
	}{Heartbeats: results}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequest("POST", c.apiURL+"/v1/monitor/heartbeats", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	return nil
}
