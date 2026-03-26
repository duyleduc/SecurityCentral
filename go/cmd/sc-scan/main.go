// sc-scan is the SecurityCentral Code Scanner CLI.
// It scans dependencies and source code for vulnerabilities and secrets.
package main

import (
	"log/slog"
	"os"

	"github.com/security-central/security-central/internal/logging"
)

func main() {
	logging.Init("sc-scan")

	slog.Info("starting", slog.String("version", version))
	os.Exit(0)
}

var version = "dev"
