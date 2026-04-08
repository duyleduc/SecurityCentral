package aws

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
)

// ELBV2Client implements ELBV2API using the AWS CLI.
// In production, this would use the AWS SDK for Go v2.
type ELBV2Client struct {
	region string
}

// NewELBV2Client creates a new ELBv2 client.
func NewELBV2Client(region string) *ELBV2Client {
	return &ELBV2Client{region: region}
}

// DescribeLoadBalancers lists all ALBs and NLBs in the region.
func (c *ELBV2Client) DescribeLoadBalancers(ctx context.Context) ([]LoadBalancer, error) {
	out, err := exec.CommandContext(ctx,
		"aws", "elbv2", "describe-load-balancers",
		"--region", c.region,
		"--output", "json",
	).Output()
	if err != nil {
		return nil, fmt.Errorf("aws elbv2 describe-load-balancers: %w", err)
	}

	var resp struct {
		LoadBalancers []struct {
			LoadBalancerArn  string `json:"LoadBalancerArn"`
			LoadBalancerName string `json:"LoadBalancerName"`
			Type             string `json:"Type"`
		} `json:"LoadBalancers"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse lb response: %w", err)
	}

	var lbs []LoadBalancer
	for _, lb := range resp.LoadBalancers {
		lbs = append(lbs, LoadBalancer{
			ARN:  lb.LoadBalancerArn,
			Name: lb.LoadBalancerName,
			Type: lb.Type,
		})
	}
	return lbs, nil
}

// DescribeListeners lists listeners for a load balancer.
func (c *ELBV2Client) DescribeListeners(ctx context.Context, lbARN string) ([]Listener, error) {
	out, err := exec.CommandContext(ctx,
		"aws", "elbv2", "describe-listeners",
		"--load-balancer-arn", lbARN,
		"--region", c.region,
		"--output", "json",
	).Output()
	if err != nil {
		return nil, fmt.Errorf("aws elbv2 describe-listeners: %w", err)
	}

	var resp struct {
		Listeners []struct {
			ListenerArn string `json:"ListenerArn"`
			Port        int    `json:"Port"`
			Protocol    string `json:"Protocol"`
			Certificates []struct {
				CertificateArn string `json:"CertificateArn"`
			} `json:"Certificates"`
		} `json:"Listeners"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse listener response: %w", err)
	}

	var listeners []Listener
	for _, l := range resp.Listeners {
		certARN := ""
		if len(l.Certificates) > 0 {
			certARN = l.Certificates[0].CertificateArn
		}
		listeners = append(listeners, Listener{
			ARN:            l.ListenerArn,
			Port:           l.Port,
			Protocol:       l.Protocol,
			CertificateARN: certARN,
		})
	}
	return listeners, nil
}
