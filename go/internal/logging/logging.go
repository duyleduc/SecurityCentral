// Package logging provides structured JSON logging for all Go components.
// It uses the standard library log/slog with a JSON handler.
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

type ctxKey string

const correlationIDKey ctxKey = "correlation_id"

// Init configures the global slog logger as a JSON handler writing to stdout.
// level is read from the SC_LOG_LEVEL env var (debug, info, warn, error); defaults to info.
// component is the name of the binary (e.g. "sc-scan", "sc-agent", "sc-certmon").
func Init(component string) {
	level := parseLevel(os.Getenv("SC_LOG_LEVEL"))

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})

	logger := slog.New(handler).With(slog.String("component", component))
	slog.SetDefault(logger)
}

// WithCorrelationID returns a new context carrying the given correlation ID.
func WithCorrelationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, correlationIDKey, id)
}

// CorrelationID extracts the correlation ID from the context, or returns "".
func CorrelationID(ctx context.Context) string {
	if id, ok := ctx.Value(correlationIDKey).(string); ok {
		return id
	}
	return ""
}

// FromContext returns a logger enriched with the correlation_id from ctx (if present).
func FromContext(ctx context.Context) *slog.Logger {
	l := slog.Default()
	if id := CorrelationID(ctx); id != "" {
		l = l.With(slog.String("correlation_id", id))
	}
	return l
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
