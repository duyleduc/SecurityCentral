package certdiscovery

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"testing"
	"time"
)

// generateSelfSignedCert creates a self-signed cert+key for testing.
func generateSelfSignedCert(cn string, sans []string) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     sans,
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}

	return tls.Certificate{
		Certificate: [][]byte{certDER},
		PrivateKey:  key,
	}, nil
}

// startTLSServer creates a local TLS server for testing.
func startTLSServer(t *testing.T, cert tls.Certificate) (addr string, cleanup func()) {
	t.Helper()

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", tlsConfig)
	if err != nil {
		t.Fatalf("failed to start TLS server: %v", err)
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()

	return listener.Addr().String(), func() { listener.Close() }
}

func TestProbe_ExtractsLeafCert(t *testing.T) {
	cert, err := generateSelfSignedCert("test.example.com", []string{"test.example.com", "alt.example.com"})
	if err != nil {
		t.Fatal(err)
	}

	addr, cleanup := startTLSServer(t, cert)
	defer cleanup()

	chain, err := ProbeWithTimeout(addr, 5*time.Second)
	if err != nil {
		t.Fatalf("probe failed: %v", err)
	}

	if chain.Leaf == nil {
		t.Fatal("expected non-nil leaf cert")
	}
	if chain.Leaf.SubjectCN != "test.example.com" {
		t.Errorf("expected CN=test.example.com, got %s", chain.Leaf.SubjectCN)
	}
	if len(chain.Leaf.SANs) < 2 {
		t.Errorf("expected at least 2 SANs, got %d", len(chain.Leaf.SANs))
	}
	if chain.Leaf.KeyAlgorithm != "ECDSA" {
		t.Errorf("expected ECDSA key, got %s", chain.Leaf.KeyAlgorithm)
	}
	if chain.Leaf.FingerprintSHA256 == "" {
		t.Error("expected non-empty fingerprint")
	}
	if chain.Endpoint != addr {
		t.Errorf("expected endpoint=%s, got %s", addr, chain.Endpoint)
	}
}

func TestProbe_IncludesIPInSANs(t *testing.T) {
	cert, err := generateSelfSignedCert("localhost", nil)
	if err != nil {
		t.Fatal(err)
	}

	addr, cleanup := startTLSServer(t, cert)
	defer cleanup()

	chain, _ := ProbeWithTimeout(addr, 5*time.Second)
	if chain.Leaf == nil {
		t.Fatal("expected leaf cert")
	}

	hasIP := false
	for _, san := range chain.Leaf.SANs {
		if san == "127.0.0.1" {
			hasIP = true
			break
		}
	}
	if !hasIP {
		t.Error("expected 127.0.0.1 in SANs")
	}
}

func TestProbe_InvalidEndpoint(t *testing.T) {
	chain, err := ProbeWithTimeout("127.0.0.1:1", 1*time.Second)
	if err == nil {
		t.Error("expected error for invalid endpoint")
	}
	if chain.Error == "" {
		t.Error("expected error message in chain")
	}
}

func TestBatchProbe(t *testing.T) {
	cert, err := generateSelfSignedCert("batch.example.com", nil)
	if err != nil {
		t.Fatal(err)
	}

	addr, cleanup := startTLSServer(t, cert)
	defer cleanup()

	endpoints := []string{addr, addr, "127.0.0.1:1"} // 2 valid + 1 invalid
	results := BatchProbe(endpoints)

	// Should have 3 results (including failed one)
	if len(results) < 2 {
		t.Errorf("expected at least 2 results, got %d", len(results))
	}

	successCount := 0
	for _, r := range results {
		if r.Leaf != nil {
			successCount++
		}
	}
	if successCount < 2 {
		t.Errorf("expected at least 2 successful probes, got %d", successCount)
	}
}

func TestBatchProbe_Empty(t *testing.T) {
	results := BatchProbe(nil)
	if len(results) != 0 {
		t.Errorf("expected 0 results for empty input, got %d", len(results))
	}
}
