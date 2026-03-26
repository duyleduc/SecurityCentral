package certdiscovery

import (
	"crypto/rsa"
	"crypto/x509"
	"fmt"
	"strings"
	"time"

	"github.com/security-central/security-central/pkg/models"
)

// CheckResult holds the outcome of a single certificate health check.
type CheckResult struct {
	CheckType   string
	Severity    models.Severity
	Title       string
	Description string
	Remediation string
}

// RunHealthChecks evaluates all certificate health checks against a probed chain.
func RunHealthChecks(chain *CertChain) []CheckResult {
	if chain.Leaf == nil {
		return nil
	}

	var results []CheckResult

	results = append(results, checkExpiry(chain)...)
	results = append(results, checkKeyStrength(chain)...)
	results = append(results, checkSignatureAlgorithm(chain)...)
	results = append(results, checkSelfSigned(chain)...)
	results = append(results, checkChainValidity(chain)...)
	results = append(results, checkWildcard(chain)...)

	return results
}

// ToFindings converts check results to platform Finding structs.
func HealthCheckFindings(chain *CertChain, results []CheckResult) []models.Finding {
	var findings []models.Finding
	now := time.Now()

	for _, r := range results {
		findings = append(findings, models.Finding{
			Source:      models.SourceCertificate,
			Severity:    r.Severity,
			Title:       r.Title,
			Description: r.Description,
			Remediation: r.Remediation,
			Detail: map[string]any{
				"check_type":   r.CheckType,
				"endpoint":     chain.Endpoint,
				"subject_cn":   chain.Leaf.SubjectCN,
				"fingerprint":  chain.Leaf.FingerprintSHA256,
				"not_after":    chain.Leaf.NotAfter.Format(time.RFC3339),
				"key_algorithm": chain.Leaf.KeyAlgorithm,
			},
			FirstSeenAt: now,
		})
	}

	return findings
}

// ---------------------------------------------------------------------------
// T-8.3.1: Expiry checks
// ---------------------------------------------------------------------------

func checkExpiry(chain *CertChain) []CheckResult {
	days := int(time.Until(chain.Leaf.NotAfter).Hours() / 24)

	var sev models.Severity
	switch {
	case days <= 0:
		sev = models.SeverityCritical
	case days <= 7:
		sev = models.SeverityCritical
	case days <= 30:
		sev = models.SeverityHigh
	case days <= 60:
		sev = models.SeverityMedium
	case days <= 90:
		sev = models.SeverityLow
	default:
		return nil
	}

	title := fmt.Sprintf("Certificate %s expires in %d days", chain.Leaf.SubjectCN, days)
	if days <= 0 {
		title = fmt.Sprintf("Certificate %s has EXPIRED", chain.Leaf.SubjectCN)
	}

	return []CheckResult{{
		CheckType:   "expiry",
		Severity:    sev,
		Title:       title,
		Description: fmt.Sprintf("Certificate for %s valid until %s (%d days remaining)", chain.Leaf.SubjectCN, chain.Leaf.NotAfter.Format("2006-01-02"), days),
		Remediation: "Renew the certificate before expiration",
	}}
}

// ---------------------------------------------------------------------------
// T-8.3.2: Key strength check
// ---------------------------------------------------------------------------

func checkKeyStrength(chain *CertChain) []CheckResult {
	if len(chain.PeerCertificates) == 0 {
		return nil
	}

	leaf := chain.PeerCertificates[0]
	if rsaKey, ok := leaf.PublicKey.(*rsa.PublicKey); ok {
		bits := rsaKey.N.BitLen()
		if bits < 2048 {
			return []CheckResult{{
				CheckType:   "weak_key",
				Severity:    models.SeverityHigh,
				Title:       fmt.Sprintf("Weak RSA key (%d bits) on %s", bits, chain.Leaf.SubjectCN),
				Description: fmt.Sprintf("RSA key is only %d bits; minimum 2048 bits recommended", bits),
				Remediation: "Regenerate certificate with at least RSA-2048 or use ECDSA P-256",
			}}
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// T-8.3.3: Signature algorithm check
// ---------------------------------------------------------------------------

func checkSignatureAlgorithm(chain *CertChain) []CheckResult {
	if len(chain.PeerCertificates) == 0 {
		return nil
	}

	leaf := chain.PeerCertificates[0]
	alg := leaf.SignatureAlgorithm.String()

	if strings.Contains(strings.ToLower(alg), "sha1") || leaf.SignatureAlgorithm == x509.SHA1WithRSA || leaf.SignatureAlgorithm == x509.ECDSAWithSHA1 {
		return []CheckResult{{
			CheckType:   "weak_signature",
			Severity:    models.SeverityHigh,
			Title:       fmt.Sprintf("SHA-1 signature on %s", chain.Leaf.SubjectCN),
			Description: fmt.Sprintf("Certificate uses deprecated %s signature algorithm", alg),
			Remediation: "Reissue certificate with SHA-256 or stronger signature algorithm",
		}}
	}

	return nil
}

// ---------------------------------------------------------------------------
// T-8.3.4: Self-signed detection
// ---------------------------------------------------------------------------

func checkSelfSigned(chain *CertChain) []CheckResult {
	if len(chain.PeerCertificates) == 0 {
		return nil
	}

	leaf := chain.PeerCertificates[0]

	// Self-signed: issuer == subject AND not a CA (i.e., leaf cert)
	if leaf.Issuer.String() == leaf.Subject.String() && !leaf.IsCA {
		return []CheckResult{{
			CheckType:   "self_signed",
			Severity:    models.SeverityMedium,
			Title:       fmt.Sprintf("Self-signed certificate on %s", chain.Leaf.SubjectCN),
			Description: "Certificate is self-signed and not issued by a trusted Certificate Authority",
			Remediation: "Replace with a certificate issued by a trusted CA (e.g., Let's Encrypt, AWS ACM)",
		}}
	}

	return nil
}

// ---------------------------------------------------------------------------
// T-8.3.5: Chain validation
// ---------------------------------------------------------------------------

func checkChainValidity(chain *CertChain) []CheckResult {
	if len(chain.PeerCertificates) == 0 {
		return nil
	}

	leaf := chain.PeerCertificates[0]

	// Build intermediate pool from chain
	intermediates := x509.NewCertPool()
	for _, cert := range chain.PeerCertificates[1:] {
		intermediates.AddCert(cert)
	}

	opts := x509.VerifyOptions{
		Intermediates: intermediates,
		CurrentTime:   time.Now(),
	}

	_, err := leaf.Verify(opts)
	if err != nil {
		return []CheckResult{{
			CheckType:   "incomplete_chain",
			Severity:    models.SeverityMedium,
			Title:       fmt.Sprintf("Incomplete certificate chain on %s", chain.Leaf.SubjectCN),
			Description: fmt.Sprintf("Chain validation failed: %s", err.Error()),
			Remediation: "Ensure the server presents the full certificate chain including intermediates",
		}}
	}

	return nil
}

// ---------------------------------------------------------------------------
// T-8.3.6: Wildcard advisory
// ---------------------------------------------------------------------------

func checkWildcard(chain *CertChain) []CheckResult {
	if chain.Leaf.SubjectCN == "" {
		return nil
	}

	if strings.HasPrefix(chain.Leaf.SubjectCN, "*.") {
		return []CheckResult{{
			CheckType:   "wildcard",
			Severity:    models.SeverityInfo,
			Title:       fmt.Sprintf("Wildcard certificate: %s", chain.Leaf.SubjectCN),
			Description: "Wildcard certificates cover all subdomains, which increases the blast radius if the private key is compromised",
			Remediation: "Consider using specific-domain certificates for critical services",
		}}
	}

	return nil
}
