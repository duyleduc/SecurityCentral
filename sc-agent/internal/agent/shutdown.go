package agent

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/securitycentral/sc-agent/internal/logging"
)

// WaitForShutdown returns a context that is cancelled on SIGINT or SIGTERM.
func WaitForShutdown(log *logging.Logger) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Info("shutdown signal received", map[string]interface{}{"signal": sig.String()})
		cancel()
	}()

	return ctx, cancel
}
