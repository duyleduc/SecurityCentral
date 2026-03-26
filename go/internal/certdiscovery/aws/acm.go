package aws

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

// ACMClient implements ACMAPI using the AWS CLI.
type ACMClient struct {
	region string
}

// NewACMClient creates a new ACM client.
func NewACMClient(region string) *ACMClient {
	return &ACMClient{region: region}
}

// DescribeCertificate fetches certificate details from ACM.
func (c *ACMClient) DescribeCertificate(ctx context.Context, certARN string) (*CertInfo, error) {
	out, err := exec.CommandContext(ctx,
		"aws", "acm", "describe-certificate",
		"--certificate-arn", certARN,
		"--region", c.region,
		"--output", "json",
	).Output()
	if err != nil {
		return nil, fmt.Errorf("aws acm describe-certificate: %w", err)
	}

	var resp struct {
		Certificate struct {
			CertificateArn        string   `json:"CertificateArn"`
			DomainName            string   `json:"DomainName"`
			SubjectAlternativeNames []string `json:"SubjectAlternativeNames"`
			Issuer                string   `json:"Issuer"`
			Serial                string   `json:"Serial"`
			NotBefore             string   `json:"NotBefore"`
			NotAfter              string   `json:"NotAfter"`
			KeyAlgorithm          string   `json:"KeyAlgorithm"`
			SignatureAlgorithm    string   `json:"SignatureAlgorithm"`
			Status                string   `json:"Status"`
		} `json:"Certificate"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse acm response: %w", err)
	}

	cert := resp.Certificate
	notBefore, _ := time.Parse(time.RFC3339, cert.NotBefore)
	notAfter, _ := time.Parse(time.RFC3339, cert.NotAfter)

	return &CertInfo{
		ARN:                cert.CertificateArn,
		SubjectCN:          cert.DomainName,
		SANs:               cert.SubjectAlternativeNames,
		IssuerCN:           cert.Issuer,
		SerialNumber:       cert.Serial,
		NotBefore:          notBefore,
		NotAfter:           notAfter,
		KeyAlgorithm:       cert.KeyAlgorithm,
		SignatureAlgorithm: cert.SignatureAlgorithm,
		Status:             cert.Status,
	}, nil
}
