package agent

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log/slog"
	"os"
	"time"
)

const renewalThreshold = 30 * 24 * time.Hour // 30 days

// CertRenewal holds the data needed for a heartbeat cert renewal request.
type CertRenewal struct {
	CSR string // PEM-encoded PKCS#10 CSR
}

// CheckCertExpiry reads the agent certificate and returns a renewal request
// if the cert expires within 30 days. Returns nil if no renewal is needed.
func CheckCertExpiry(certPath, keyPath string) *CertRenewal {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		slog.Warn("cannot load cert for expiry check", "error", err)
		return nil
	}

	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		slog.Warn("cannot parse cert for expiry check", "error", err)
		return nil
	}

	remaining := time.Until(leaf.NotAfter)
	slog.Debug("certificate expiry check", "not_after", leaf.NotAfter, "remaining_days", int(remaining.Hours()/24))

	if remaining > renewalThreshold {
		return nil
	}

	slog.Info("certificate expiring soon, requesting renewal",
		"not_after", leaf.NotAfter,
		"remaining_days", int(remaining.Hours()/24),
	)

	// Generate CSR using the existing private key
	privKey, ok := cert.PrivateKey.(*ecdsa.PrivateKey)
	if !ok {
		// Try to generate a new key if existing isn't ECDSA
		var err error
		privKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			slog.Error("failed to generate new key for renewal", "error", err)
			return nil
		}
	}

	csrTemplate := &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: leaf.Subject.CommonName},
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, csrTemplate, privKey)
	if err != nil {
		slog.Error("failed to create renewal CSR", "error", err)
		return nil
	}

	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})

	return &CertRenewal{CSR: string(csrPEM)}
}

// WriteRenewedCert writes the new certificate PEM to the cert file path.
func WriteRenewedCert(certPath, certPEM string) error {
	if err := os.WriteFile(certPath, []byte(certPEM), 0644); err != nil {
		return fmt.Errorf("write renewed cert: %w", err)
	}
	slog.Info("renewed certificate written", "path", certPath)
	return nil
}
