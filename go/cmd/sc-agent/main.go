// sc-agent is the SecurityCentral Infrastructure Agent.
// It runs on target servers to scan for OS vulnerabilities and misconfigurations.
package main

import (
	"log/slog"
	"os"

	"github.com/security-central/security-central/internal/logging"
)

func main() {
	logging.Init("sc-agent")

	slog.Info("starting", slog.String("version", version))
	os.Exit(0)
}

var version = "dev"
