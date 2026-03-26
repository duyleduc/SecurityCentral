// sc-certmon is the SecurityCentral Certificate Monitor.
// It discovers and monitors TLS certificates for expiration and chain validity.
package main

import (
	"log/slog"
	"os"

	"github.com/security-central/security-central/internal/logging"
)

func main() {
	logging.Init("sc-certmon")

	slog.Info("starting", slog.String("version", version))
	os.Exit(0)
}

var version = "dev"
