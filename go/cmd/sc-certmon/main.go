// sc-certmon is the SecurityCentral Certificate Monitor.
// It discovers and monitors TLS certificates for expiration and chain validity.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/security-central/security-central/internal/certdiscovery/aws"
	"github.com/security-central/security-central/internal/logging"
	"github.com/security-central/security-central/internal/platform"
)

var version = "dev"

func main() {
	logging.Init("sc-certmon")

	oneShot := flag.Bool("once", false, "Run once and exit (instead of scheduled)")
	interval := flag.Duration("interval", 1*time.Hour, "Discovery interval")
	region := flag.String("region", os.Getenv("AWS_REGION"), "AWS region")
	apiURL := flag.String("api-url", os.Getenv("SC_PLATFORM_URL"), "Platform API URL")
	apiKey := flag.String("api-key", os.Getenv("SC_API_KEY"), "Platform API key")
	flag.Parse()

	if *region == "" {
		*region = "us-east-1"
	}

	slog.Info("starting", "version", version, "region", *region, "interval", *interval)

	client := platform.New(*apiURL, *apiKey)
	elbv2 := aws.NewELBV2Client(*region)
	acm := aws.NewACMClient(*region)
	discoverer := aws.NewDiscoverer(elbv2, acm)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if *oneShot {
		runDiscovery(ctx, discoverer, client)
		return
	}

	// Scheduled mode
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()

	// Run immediately on startup
	runDiscovery(ctx, discoverer, client)

	for {
		select {
		case <-ticker.C:
			runDiscovery(ctx, discoverer, client)
		case sig := <-sigCh:
			slog.Info("shutting down", "signal", sig.String())
			cancel()
			return
		}
	}
}

func runDiscovery(ctx context.Context, discoverer *aws.Discoverer, client *platform.Client) {
	startTime := time.Now()

	certs, err := discoverer.DiscoverAll(ctx)
	if err != nil {
		slog.Error("certificate discovery failed", "error", err)
		return
	}

	findings := aws.ToFindings(certs)
	slog.Info("discovery complete", "certs", len(certs), "findings", len(findings), "duration_ms", time.Since(startTime).Milliseconds())

	if len(findings) > 0 && client != nil {
		_, err := client.SubmitFindings(findings, "cert_discovery", startTime, time.Now())
		if err != nil {
			slog.Error("failed to submit findings", "error", err)
		}
	}
}
