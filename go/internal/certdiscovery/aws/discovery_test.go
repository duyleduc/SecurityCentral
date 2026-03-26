package aws

import (
	"context"
	"testing"
	"time"
)

// --- Mock implementations ---

type mockELBV2 struct {
	lbs       []LoadBalancer
	listeners map[string][]Listener
}

func (m *mockELBV2) DescribeLoadBalancers(_ context.Context) ([]LoadBalancer, error) {
	return m.lbs, nil
}

func (m *mockELBV2) DescribeListeners(_ context.Context, lbARN string) ([]Listener, error) {
	return m.listeners[lbARN], nil
}

type mockACM struct {
	certs map[string]*CertInfo
}

func (m *mockACM) DescribeCertificate(_ context.Context, certARN string) (*CertInfo, error) {
	if cert, ok := m.certs[certARN]; ok {
		return cert, nil
	}
	return nil, nil
}

// --- Tests ---

func TestDiscoverAll(t *testing.T) {
	elbv2 := &mockELBV2{
		lbs: []LoadBalancer{
			{ARN: "arn:lb:1", Name: "my-alb", Type: "application"},
			{ARN: "arn:lb:2", Name: "my-nlb", Type: "network"},
		},
		listeners: map[string][]Listener{
			"arn:lb:1": {
				{ARN: "arn:listener:1", Port: 443, Protocol: "HTTPS", CertificateARN: "arn:cert:1"},
				{ARN: "arn:listener:2", Port: 80, Protocol: "HTTP"},
			},
			"arn:lb:2": {
				{ARN: "arn:listener:3", Port: 443, Protocol: "TLS", CertificateARN: "arn:cert:2"},
			},
		},
	}

	acm := &mockACM{
		certs: map[string]*CertInfo{
			"arn:cert:1": {
				ARN:            "arn:cert:1",
				SubjectCN:      "*.example.com",
				SANs:           []string{"example.com", "*.example.com"},
				IssuerCN:       "Amazon",
				NotBefore:      time.Now().Add(-30 * 24 * time.Hour),
				NotAfter:       time.Now().Add(60 * 24 * time.Hour),
				KeyAlgorithm:   "RSA-2048",
				Status:         "ISSUED",
			},
			"arn:cert:2": {
				ARN:            "arn:cert:2",
				SubjectCN:      "api.example.com",
				SANs:           []string{"api.example.com"},
				IssuerCN:       "Amazon",
				NotBefore:      time.Now().Add(-365 * 24 * time.Hour),
				NotAfter:       time.Now().Add(5 * 24 * time.Hour), // expiring soon
				KeyAlgorithm:   "ECDSA-P256",
				Status:         "ISSUED",
			},
		},
	}

	disc := NewDiscoverer(elbv2, acm)
	certs, err := disc.DiscoverAll(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(certs) != 2 {
		t.Fatalf("expected 2 certs, got %d", len(certs))
	}

	// Verify discovered_from is set
	for _, c := range certs {
		if c.DiscoveredFrom == "" {
			t.Errorf("expected DiscoveredFrom to be set for %s", c.SubjectCN)
		}
	}
}

func TestDiscoverAll_SkipsHTTPListeners(t *testing.T) {
	elbv2 := &mockELBV2{
		lbs: []LoadBalancer{
			{ARN: "arn:lb:1", Name: "http-only", Type: "application"},
		},
		listeners: map[string][]Listener{
			"arn:lb:1": {
				{ARN: "arn:l:1", Port: 80, Protocol: "HTTP"},
			},
		},
	}

	disc := NewDiscoverer(elbv2, &mockACM{certs: map[string]*CertInfo{}})
	certs, err := disc.DiscoverAll(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(certs) != 0 {
		t.Errorf("expected 0 certs for HTTP-only LB, got %d", len(certs))
	}
}

func TestDiscoverAll_DeduplicatesCerts(t *testing.T) {
	// Two LBs sharing the same cert ARN
	elbv2 := &mockELBV2{
		lbs: []LoadBalancer{
			{ARN: "arn:lb:1", Name: "alb-1", Type: "application"},
			{ARN: "arn:lb:2", Name: "alb-2", Type: "application"},
		},
		listeners: map[string][]Listener{
			"arn:lb:1": {{ARN: "arn:l:1", Port: 443, Protocol: "HTTPS", CertificateARN: "arn:cert:shared"}},
			"arn:lb:2": {{ARN: "arn:l:2", Port: 443, Protocol: "HTTPS", CertificateARN: "arn:cert:shared"}},
		},
	}

	acm := &mockACM{
		certs: map[string]*CertInfo{
			"arn:cert:shared": {ARN: "arn:cert:shared", SubjectCN: "shared.example.com", NotAfter: time.Now().Add(365 * 24 * time.Hour)},
		},
	}

	disc := NewDiscoverer(elbv2, acm)
	certs, err := disc.DiscoverAll(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(certs) != 1 {
		t.Errorf("expected 1 deduplicated cert, got %d", len(certs))
	}
}

func TestToFindings(t *testing.T) {
	now := time.Now()
	certs := []CertInfo{
		{SubjectCN: "expired.com", NotAfter: now.Add(-24 * time.Hour), Status: "ISSUED"},
		{SubjectCN: "soon.com", NotAfter: now.Add(5 * 24 * time.Hour), Status: "ISSUED"},
		{SubjectCN: "ok.com", NotAfter: now.Add(180 * 24 * time.Hour), Status: "ISSUED"},
	}

	findings := ToFindings(certs)

	// expired + soon should generate findings; ok should not
	if len(findings) != 2 {
		t.Fatalf("expected 2 findings, got %d", len(findings))
	}

	// Expired cert should be critical
	if findings[0].Severity != "critical" {
		t.Errorf("expected critical for expired cert, got %s", findings[0].Severity)
	}

	// Soon-to-expire should be critical (<=7 days)
	if findings[1].Severity != "critical" {
		t.Errorf("expected critical for 5-day cert, got %s", findings[1].Severity)
	}
}

func TestToFindings_SeverityLevels(t *testing.T) {
	now := time.Now()
	tests := []struct {
		daysUntilExpiry int
		wantSeverity    string
	}{
		{-1, "critical"},
		{0, "critical"},
		{5, "critical"},
		{15, "high"},
		{45, "medium"},
		{80, "low"},
		{120, ""},
	}

	for _, tt := range tests {
		certs := []CertInfo{{
			SubjectCN: "test.com",
			NotAfter:  now.Add(time.Duration(tt.daysUntilExpiry) * 24 * time.Hour),
			Status:    "ISSUED",
		}}
		findings := ToFindings(certs)

		if tt.wantSeverity == "" {
			if len(findings) != 0 {
				t.Errorf("days=%d: expected 0 findings, got %d", tt.daysUntilExpiry, len(findings))
			}
		} else {
			if len(findings) != 1 {
				t.Errorf("days=%d: expected 1 finding, got %d", tt.daysUntilExpiry, len(findings))
				continue
			}
			if string(findings[0].Severity) != tt.wantSeverity {
				t.Errorf("days=%d: expected severity=%s, got %s", tt.daysUntilExpiry, tt.wantSeverity, findings[0].Severity)
			}
		}
	}
}
