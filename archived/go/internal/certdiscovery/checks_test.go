package certdiscovery

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"testing"
	"time"
)

func makeChain(cn string, notAfter time.Time, opts ...func(*x509.Certificate, interface{})) *CertChain {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		Issuer:       pkix.Name{CommonName: "Test CA"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}

	var privKey interface{} = key
	for _, opt := range opts {
		opt(template, privKey)
	}

	certDER, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(certDER)

	return &CertChain{
		Endpoint:         "test:443",
		Leaf:             extractDetail(cert),
		PeerCertificates: []*x509.Certificate{cert},
	}
}

func TestCheckExpiry_Expired(t *testing.T) {
	chain := makeChain("expired.com", time.Now().Add(-24*time.Hour))
	results := checkExpiry(chain)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Severity != "critical" {
		t.Errorf("expected critical, got %s", results[0].Severity)
	}
	if results[0].CheckType != "expiry" {
		t.Errorf("expected check_type=expiry, got %s", results[0].CheckType)
	}
}

func TestCheckExpiry_7Days(t *testing.T) {
	chain := makeChain("soon.com", time.Now().Add(5*24*time.Hour))
	results := checkExpiry(chain)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Severity != "critical" {
		t.Errorf("expected critical for <=7 days, got %s", results[0].Severity)
	}
}

func TestCheckExpiry_30Days(t *testing.T) {
	chain := makeChain("medium.com", time.Now().Add(20*24*time.Hour))
	results := checkExpiry(chain)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Severity != "high" {
		t.Errorf("expected high for <=30 days, got %s", results[0].Severity)
	}
}

func TestCheckExpiry_NoFinding(t *testing.T) {
	chain := makeChain("ok.com", time.Now().Add(180*24*time.Hour))
	results := checkExpiry(chain)

	if len(results) != 0 {
		t.Errorf("expected 0 results for far-future cert, got %d", len(results))
	}
}

func TestCheckKeyStrength_WeakRSA(t *testing.T) {
	// Generate a 1024-bit RSA key (weak)
	key, _ := rsa.GenerateKey(rand.Reader, 1024)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "weak.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
	}

	certDER, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(certDER)

	chain := &CertChain{
		Leaf:             extractDetail(cert),
		PeerCertificates: []*x509.Certificate{cert},
	}

	results := checkKeyStrength(chain)
	if len(results) != 1 {
		t.Fatalf("expected 1 result for weak key, got %d", len(results))
	}
	if results[0].Severity != "high" {
		t.Errorf("expected high, got %s", results[0].Severity)
	}
}

func TestCheckKeyStrength_StrongECDSA(t *testing.T) {
	chain := makeChain("strong.com", time.Now().Add(365*24*time.Hour))
	results := checkKeyStrength(chain)

	if len(results) != 0 {
		t.Errorf("expected 0 results for ECDSA P-256, got %d", len(results))
	}
}

func TestCheckSelfSigned(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "self.com"},
		Issuer:       pkix.Name{CommonName: "self.com"}, // issuer == subject
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		IsCA:         false,
	}

	certDER, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(certDER)

	chain := &CertChain{
		Leaf:             extractDetail(cert),
		PeerCertificates: []*x509.Certificate{cert},
	}

	results := checkSelfSigned(chain)
	if len(results) != 1 {
		t.Fatalf("expected 1 result for self-signed, got %d", len(results))
	}
	if results[0].Severity != "medium" {
		t.Errorf("expected medium, got %s", results[0].Severity)
	}
}

func TestCheckSelfSigned_CA(t *testing.T) {
	// CA certs that are self-signed should NOT trigger this check
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Root CA"},
		Issuer:                pkix.Name{CommonName: "Root CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(3650 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	certDER, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(certDER)

	chain := &CertChain{
		Leaf:             extractDetail(cert),
		PeerCertificates: []*x509.Certificate{cert},
	}

	results := checkSelfSigned(chain)
	if len(results) != 0 {
		t.Errorf("expected 0 results for CA cert, got %d", len(results))
	}
}

func TestCheckWildcard(t *testing.T) {
	chain := makeChain("*.example.com", time.Now().Add(365*24*time.Hour))
	results := checkWildcard(chain)

	if len(results) != 1 {
		t.Fatalf("expected 1 wildcard advisory, got %d", len(results))
	}
	if results[0].Severity != "info" {
		t.Errorf("expected info, got %s", results[0].Severity)
	}
}

func TestCheckWildcard_NonWildcard(t *testing.T) {
	chain := makeChain("specific.example.com", time.Now().Add(365*24*time.Hour))
	results := checkWildcard(chain)

	if len(results) != 0 {
		t.Errorf("expected 0 results for non-wildcard, got %d", len(results))
	}
}

func TestRunHealthChecks_CombinesAll(t *testing.T) {
	// Self-signed + wildcard + expiring in 80 days
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "*.test.com"},
		Issuer:       pkix.Name{CommonName: "*.test.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(80 * 24 * time.Hour),
	}

	certDER, _ := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(certDER)

	chain := &CertChain{
		Endpoint:         "test:443",
		Leaf:             extractDetail(cert),
		PeerCertificates: []*x509.Certificate{cert},
	}

	results := RunHealthChecks(chain)

	// Should have: expiry(low) + self-signed(medium) + incomplete_chain(medium) + wildcard(info)
	if len(results) < 3 {
		t.Errorf("expected at least 3 check results, got %d", len(results))
	}

	checkTypes := map[string]bool{}
	for _, r := range results {
		checkTypes[r.CheckType] = true
	}

	if !checkTypes["expiry"] {
		t.Error("expected expiry check")
	}
	if !checkTypes["self_signed"] {
		t.Error("expected self_signed check")
	}
	if !checkTypes["wildcard"] {
		t.Error("expected wildcard check")
	}
}

func TestHealthCheckFindings(t *testing.T) {
	chain := makeChain("test.com", time.Now().Add(5*24*time.Hour))
	results := RunHealthChecks(chain)
	findings := HealthCheckFindings(chain, results)

	if len(findings) != len(results) {
		t.Errorf("expected %d findings, got %d", len(results), len(findings))
	}

	for _, f := range findings {
		if f.Source != "certificate" {
			t.Errorf("expected source=certificate, got %s", f.Source)
		}
		detail := f.Detail
		if detail["endpoint"] != "test:443" {
			t.Errorf("expected endpoint=test:443 in detail")
		}
	}
}
