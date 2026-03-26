// Package certdiscovery implements TLS certificate discovery, extraction, and chain validation.
package certdiscovery

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"
)

const (
	defaultTimeout    = 10 * time.Second
	maxConcurrentProbes = 20
)

// CertChain holds a leaf certificate and its chain peers from a TLS probe.
type CertChain struct {
	Endpoint         string
	Leaf             *CertDetail
	Intermediates    []*CertDetail
	PeerCertificates []*x509.Certificate // raw chain for validation
	Error            string
}

// CertDetail holds extracted fields from a single X.509 certificate.
type CertDetail struct {
	SubjectCN          string
	SANs               []string
	IssuerCN           string
	SerialNumber       string
	FingerprintSHA256  string
	NotBefore          time.Time
	NotAfter           time.Time
	KeyAlgorithm       string
	SignatureAlgorithm string
	IsCA               bool
}

// Probe connects to a single host:port endpoint via TLS and extracts the certificate chain.
func Probe(endpoint string) (*CertChain, error) {
	return ProbeWithTimeout(endpoint, defaultTimeout)
}

// ProbeWithTimeout connects with a custom timeout.
func ProbeWithTimeout(endpoint string, timeout time.Duration) (*CertChain, error) {
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		// Assume port 443 if not specified
		host = endpoint
		endpoint = endpoint + ":443"
	}

	dialer := &net.Dialer{Timeout: timeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", endpoint, &tls.Config{
		InsecureSkipVerify: true, // we verify ourselves — need to connect even to expired certs
		ServerName:         host,
	})
	if err != nil {
		return &CertChain{Endpoint: endpoint, Error: err.Error()}, err
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return &CertChain{Endpoint: endpoint, Error: "no certificates presented"}, fmt.Errorf("no certificates")
	}

	chain := &CertChain{
		Endpoint:         endpoint,
		PeerCertificates: state.PeerCertificates,
		Leaf:             extractDetail(state.PeerCertificates[0]),
	}

	for _, cert := range state.PeerCertificates[1:] {
		chain.Intermediates = append(chain.Intermediates, extractDetail(cert))
	}

	return chain, nil
}

// BatchProbe probes multiple endpoints concurrently with bounded concurrency.
func BatchProbe(endpoints []string) []*CertChain {
	results := make([]*CertChain, len(endpoints))
	sem := make(chan struct{}, maxConcurrentProbes)
	var wg sync.WaitGroup

	for i, ep := range endpoints {
		wg.Add(1)
		go func(idx int, endpoint string) {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			slog.Debug("probing endpoint", "endpoint", endpoint)
			chain, err := Probe(endpoint)
			if err != nil {
				slog.Warn("probe failed", "endpoint", endpoint, "error", err)
			}
			results[idx] = chain
		}(i, ep)
	}

	wg.Wait()

	// Filter out nil results
	var filtered []*CertChain
	for _, r := range results {
		if r != nil {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

func extractDetail(cert *x509.Certificate) *CertDetail {
	fingerprint := sha256.Sum256(cert.Raw)

	var keyAlgo string
	switch cert.PublicKeyAlgorithm {
	case x509.RSA:
		keyAlgo = "RSA"
	case x509.ECDSA:
		keyAlgo = "ECDSA"
	case x509.Ed25519:
		keyAlgo = "Ed25519"
	default:
		keyAlgo = cert.PublicKeyAlgorithm.String()
	}

	sans := make([]string, 0, len(cert.DNSNames)+len(cert.IPAddresses))
	sans = append(sans, cert.DNSNames...)
	for _, ip := range cert.IPAddresses {
		sans = append(sans, ip.String())
	}

	return &CertDetail{
		SubjectCN:          extractCN(cert.Subject.String()),
		SANs:               sans,
		IssuerCN:           extractCN(cert.Issuer.String()),
		SerialNumber:       cert.SerialNumber.Text(16),
		FingerprintSHA256:  hex.EncodeToString(fingerprint[:]),
		NotBefore:          cert.NotBefore,
		NotAfter:           cert.NotAfter,
		KeyAlgorithm:       keyAlgo,
		SignatureAlgorithm: cert.SignatureAlgorithm.String(),
		IsCA:               cert.IsCA,
	}
}

func extractCN(subject string) string {
	for _, part := range strings.Split(subject, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "CN=") {
			return strings.TrimPrefix(part, "CN=")
		}
	}
	return subject
}
