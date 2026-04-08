// Package aws implements certificate discovery from AWS ALB/NLB and ACM.
package aws

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// CertInfo holds the extracted certificate details from ACM.
type CertInfo struct {
	ARN                string
	SubjectCN          string
	SANs               []string
	IssuerCN           string
	SerialNumber       string
	NotBefore          time.Time
	NotAfter           time.Time
	KeyAlgorithm       string
	SignatureAlgorithm string
	Status             string
	DiscoveredFrom     string // e.g., "alb:arn:aws:elasticloadbalancing:..."
}

// ELBV2API is the interface for AWS ELBv2 operations (for testability).
type ELBV2API interface {
	DescribeLoadBalancers(ctx context.Context) ([]LoadBalancer, error)
	DescribeListeners(ctx context.Context, lbARN string) ([]Listener, error)
}

// ACMAPI is the interface for AWS ACM operations (for testability).
type ACMAPI interface {
	DescribeCertificate(ctx context.Context, certARN string) (*CertInfo, error)
}

// LoadBalancer represents an AWS ALB/NLB.
type LoadBalancer struct {
	ARN  string
	Name string
	Type string // application | network
}

// Listener represents an ELBv2 listener.
type Listener struct {
	ARN            string
	Port           int
	Protocol       string
	CertificateARN string
}

// Discoverer finds certificates from AWS load balancers.
type Discoverer struct {
	elbv2 ELBV2API
	acm   ACMAPI
}

// NewDiscoverer creates a new AWS certificate discoverer.
func NewDiscoverer(elbv2 ELBV2API, acm ACMAPI) *Discoverer {
	return &Discoverer{elbv2: elbv2, acm: acm}
}

// DiscoverAll finds all certificates attached to ALB/NLB HTTPS listeners.
func (d *Discoverer) DiscoverAll(ctx context.Context) ([]CertInfo, error) {
	lbs, err := d.elbv2.DescribeLoadBalancers(ctx)
	if err != nil {
		return nil, fmt.Errorf("describe load balancers: %w", err)
	}

	slog.Info("discovered load balancers", "count", len(lbs))

	// Collect unique cert ARNs with their source
	certSources := make(map[string]string) // certARN → discoveredFrom

	for _, lb := range lbs {
		listeners, err := d.elbv2.DescribeListeners(ctx, lb.ARN)
		if err != nil {
			slog.Warn("failed to describe listeners", "lb", lb.Name, "error", err)
			continue
		}

		for _, l := range listeners {
			if l.Protocol == "HTTPS" || l.Protocol == "TLS" {
				if l.CertificateARN != "" {
					source := fmt.Sprintf("%s:%s", lb.Type, lb.ARN)
					certSources[l.CertificateARN] = source
				}
			}
		}
	}

	slog.Info("discovered certificate ARNs", "count", len(certSources))

	// Fetch certificate details from ACM
	var certs []CertInfo
	for arn, source := range certSources {
		cert, err := d.acm.DescribeCertificate(ctx, arn)
		if err != nil {
			slog.Warn("failed to describe certificate", "arn", arn, "error", err)
			continue
		}
		cert.DiscoveredFrom = source
		certs = append(certs, *cert)
	}

	slog.Info("fetched certificate details", "count", len(certs))
	return certs, nil
}
