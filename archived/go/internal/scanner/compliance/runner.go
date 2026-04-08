package compliance

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/security-central/security-central/pkg/models"
)

// RunAll executes all registered checks and returns findings for failed checks.
func RunAll(ctx context.Context) ([]models.Finding, error) {
	slog.Info("running CIS compliance checks", "total_checks", len(Registry))

	var findings []models.Finding
	passed, failed := 0, 0

	for _, check := range Registry {
		result, err := check.Run(ctx)
		if err != nil {
			slog.Warn("check error", "check_id", check.ID(), "error", err)
			continue
		}

		if result.Pass {
			passed++
			slog.Debug("check passed", "check_id", check.ID())
			continue
		}

		failed++
		findings = append(findings, models.Finding{
			Source:      models.SourceInfra,
			Severity:    models.SeverityMedium,
			Title:       fmt.Sprintf("[%s] %s", check.ID(), check.Title()),
			Description: result.Details,
			Remediation: result.Fix,
			Detail: map[string]any{
				"check_id":    check.ID(),
				"check_level": check.Level(),
				"details":     result.Details,
			},
			FirstSeenAt: time.Now(),
		})
	}

	slog.Info("compliance checks complete", "passed", passed, "failed", failed, "total", len(Registry))
	return findings, nil
}
