package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestInit(t *testing.T) {
	// Init should not panic
	Init("test-component")

	// After Init, default logger should produce JSON with "component" field
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(handler).With(slog.String("component", "test-component"))

	logger.Info("hello")

	var entry map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("expected valid JSON, got: %s", buf.String())
	}

	if entry["component"] != "test-component" {
		t.Errorf("expected component=test-component, got %v", entry["component"])
	}
	if entry["msg"] != "hello" {
		t.Errorf("expected msg=hello, got %v", entry["msg"])
	}
	if _, ok := entry["time"]; !ok {
		t.Error("expected time field in log entry")
	}
}

func TestCorrelationID(t *testing.T) {
	ctx := context.Background()

	// No correlation ID set
	if id := CorrelationID(ctx); id != "" {
		t.Errorf("expected empty string, got %q", id)
	}

	// Set correlation ID
	ctx = WithCorrelationID(ctx, "req-123")
	if id := CorrelationID(ctx); id != "req-123" {
		t.Errorf("expected req-123, got %q", id)
	}
}

func TestFromContext(t *testing.T) {
	Init("test")

	ctx := WithCorrelationID(context.Background(), "corr-456")
	logger := FromContext(ctx)

	// Logger should not be nil
	if logger == nil {
		t.Fatal("expected non-nil logger")
	}

	// Verify it produces output with correlation_id
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, nil)
	testLogger := slog.New(handler).With(slog.String("correlation_id", "corr-456"))
	testLogger.Info("test")

	var entry map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("expected valid JSON: %s", buf.String())
	}

	if entry["correlation_id"] != "corr-456" {
		t.Errorf("expected correlation_id=corr-456, got %v", entry["correlation_id"])
	}
}

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"DEBUG", slog.LevelDebug},
		{"info", slog.LevelInfo},
		{"warn", slog.LevelWarn},
		{"warning", slog.LevelWarn},
		{"error", slog.LevelError},
		{"", slog.LevelInfo},
		{"unknown", slog.LevelInfo},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseLevel(tt.input)
			if got != tt.expected {
				t.Errorf("parseLevel(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}
