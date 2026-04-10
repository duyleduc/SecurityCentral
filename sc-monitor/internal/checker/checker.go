package checker

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/securitycentral/sc-monitor/internal/platform"
)

// Check performs an HTTP health check on the endpoint and returns the result.
func Check(ep platform.Endpoint) platform.HeartbeatResult {
	timeout := time.Duration(ep.UptimeTimeout) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	url := buildURL(ep)

	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	start := time.Now()

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return platform.HeartbeatResult{
			EndpointID: ep.ID,
			IsUp:       false,
			ResponseMs: int(time.Since(start).Milliseconds()),
			Error:      fmt.Sprintf("invalid request: %s", err.Error()),
		}
	}
	req.Header.Set("User-Agent", "SecurityCentral-Monitor/1.0")

	resp, err := client.Do(req)
	responseMs := int(time.Since(start).Milliseconds())

	if err != nil {
		return platform.HeartbeatResult{
			EndpointID: ep.ID,
			IsUp:       false,
			ResponseMs: responseMs,
			Error:      err.Error(),
		}
	}
	defer resp.Body.Close()

	return platform.HeartbeatResult{
		EndpointID: ep.ID,
		IsUp:       true,
		StatusCode: resp.StatusCode,
		ResponseMs: responseMs,
	}
}

func buildURL(ep platform.Endpoint) string {
	host := extractHostname(ep.Host)
	proto := ep.Protocol
	if proto == "" {
		proto = "https"
	}

	// If the original host was a full URL, use it directly
	if strings.HasPrefix(ep.Host, "http://") || strings.HasPrefix(ep.Host, "https://") {
		return ep.Host
	}

	port := ep.Port
	isDefaultPort := (proto == "https" && port == 443) || (proto == "http" && port == 80) || port == 0
	if isDefaultPort {
		return fmt.Sprintf("%s://%s", proto, host)
	}
	return fmt.Sprintf("%s://%s:%d", proto, host, port)
}

// extractHostname strips protocol and path from a host that might be a full URL.
func extractHostname(input string) string {
	s := strings.TrimSpace(input)
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		// Remove protocol
		idx := strings.Index(s, "://")
		s = s[idx+3:]
	}
	// Remove path
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	// Remove port
	if i := strings.LastIndex(s, ":"); i >= 0 {
		s = s[:i]
	}
	return s
}
