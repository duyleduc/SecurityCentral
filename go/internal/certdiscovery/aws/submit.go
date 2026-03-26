package aws

import (
	"time"

	"github.com/security-central/security-central/pkg/models"
)

// ToFindings converts discovered certificates to platform Finding format.
// Certificates nearing expiration (within 90 days) generate findings.
func ToFindings(certs []CertInfo) []models.Finding {
	var findings []models.Finding
	now := time.Now()

	for _, cert := range certs {
		daysUntilExpiry := int(cert.NotAfter.Sub(now).Hours() / 24)

		severity := certSeverity(daysUntilExpiry)
		if severity == "" {
			continue // cert is far from expiry, no finding needed
		}

		findings = append(findings, models.Finding{
			Source:   models.SourceCertificate,
			Severity: severity,
			Title:    certTitle(cert.SubjectCN, daysUntilExpiry),
			Description: certDescription(cert, daysUntilExpiry),
			Detail: map[string]any{
				"subject_cn":          cert.SubjectCN,
				"sans":                cert.SANs,
				"issuer_cn":           cert.IssuerCN,
				"serial_number":       cert.SerialNumber,
				"not_before":          cert.NotBefore.Format(time.RFC3339),
				"not_after":           cert.NotAfter.Format(time.RFC3339),
				"key_algorithm":       cert.KeyAlgorithm,
				"signature_algorithm": cert.SignatureAlgorithm,
				"days_until_expiry":   daysUntilExpiry,
				"discovered_from":     cert.DiscoveredFrom,
				"arn":                 cert.ARN,
			},
			Remediation: certRemediation(cert),
			FirstSeenAt: now,
		})
	}

	return findings
}

func certSeverity(daysUntilExpiry int) models.Severity {
	switch {
	case daysUntilExpiry <= 0:
		return models.SeverityCritical
	case daysUntilExpiry <= 7:
		return models.SeverityCritical
	case daysUntilExpiry <= 30:
		return models.SeverityHigh
	case daysUntilExpiry <= 60:
		return models.SeverityMedium
	case daysUntilExpiry <= 90:
		return models.SeverityLow
	default:
		return "" // no finding
	}
}

func certTitle(cn string, days int) string {
	if days <= 0 {
		return "EXPIRED certificate: " + cn
	}
	return "Certificate expiring: " + cn
}

func certDescription(cert CertInfo, days int) string {
	if days <= 0 {
		return "Certificate " + cert.SubjectCN + " has expired"
	}
	return "Certificate " + cert.SubjectCN + " expires in " + itoa(days) + " days"
}

func certRemediation(cert CertInfo) string {
	if cert.Status == "ISSUED" {
		return "Renew or replace the certificate for " + cert.SubjectCN + " in AWS ACM"
	}
	return "Request a new certificate for " + cert.SubjectCN + " in AWS ACM"
}

func itoa(i int) string {
	if i < 0 {
		return "-" + itoa(-i)
	}
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
