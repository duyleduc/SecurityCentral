// Package agent implements the infrastructure agent's core lifecycle.
// This file handles the offline finding queue for network resilience.
package agent

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	defaultQueueDir = "/var/lib/securitycentral/queue"
	maxQueueSize    = 100
	maxBackoff      = 5 * time.Minute
	initialBackoff  = 1 * time.Second
)

// OfflineQueue stores scan results locally when the platform is unreachable.
// Files are stored as numbered JSON files in FIFO order.
type OfflineQueue struct {
	dir string
}

// QueueEntry is the serialized form of a queued finding submission.
type QueueEntry struct {
	Payload   json.RawMessage `json:"payload"`
	CreatedAt string          `json:"created_at"`
	Attempts  int             `json:"attempts"`
}

// NewOfflineQueue creates or opens the offline queue at the given directory.
func NewOfflineQueue(dir string) (*OfflineQueue, error) {
	if dir == "" {
		dir = defaultQueueDir
	}
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, fmt.Errorf("create queue dir: %w", err)
	}
	return &OfflineQueue{dir: dir}, nil
}

// Enqueue adds a finding payload to the offline queue.
// If the queue exceeds maxQueueSize, the oldest entry is dropped.
func (q *OfflineQueue) Enqueue(payload json.RawMessage) error {
	// Enforce size limit — drop oldest if at capacity
	entries, _ := q.listFiles()
	if len(entries) >= maxQueueSize {
		oldest := entries[0]
		slog.Warn("queue at capacity, dropping oldest entry", "file", oldest)
		os.Remove(filepath.Join(q.dir, oldest))
	}

	entry := QueueEntry{
		Payload:   payload,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Attempts:  0,
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal queue entry: %w", err)
	}

	filename := fmt.Sprintf("%d.json", time.Now().UnixNano())
	path := filepath.Join(q.dir, filename)

	if err := os.WriteFile(path, data, 0640); err != nil {
		return fmt.Errorf("write queue file: %w", err)
	}

	slog.Info("enqueued finding for retry", "file", filename, "queue_size", len(entries)+1)
	return nil
}

// Drain returns all queued entries in FIFO order and removes them from disk.
// Returns nil if the queue is empty.
func (q *OfflineQueue) Drain() ([]QueueEntry, error) {
	files, err := q.listFiles()
	if err != nil || len(files) == 0 {
		return nil, err
	}

	var entries []QueueEntry
	for _, f := range files {
		path := filepath.Join(q.dir, f)
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("failed to read queue file", "file", f, "error", err)
			continue
		}

		var entry QueueEntry
		if err := json.Unmarshal(data, &entry); err != nil {
			slog.Warn("failed to parse queue file", "file", f, "error", err)
			os.Remove(path) // remove corrupt file
			continue
		}

		entries = append(entries, entry)
		os.Remove(path)
	}

	slog.Info("drained offline queue", "count", len(entries))
	return entries, nil
}

// Size returns the number of entries currently in the queue.
func (q *OfflineQueue) Size() int {
	files, _ := q.listFiles()
	return len(files)
}

// IsEmpty returns true if the queue has no entries.
func (q *OfflineQueue) IsEmpty() bool {
	return q.Size() == 0
}

func (q *OfflineQueue) listFiles() ([]string, error) {
	dirEntries, err := os.ReadDir(q.dir)
	if err != nil {
		return nil, err
	}

	var files []string
	for _, e := range dirEntries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, e.Name())
		}
	}

	// Sort by name (timestamp-based) for FIFO order
	sort.Strings(files)
	return files, nil
}

// BackoffDuration calculates exponential backoff for the given attempt number.
// Starts at 1s, doubles each time, caps at 5 minutes.
func BackoffDuration(attempt int) time.Duration {
	if attempt <= 0 {
		return initialBackoff
	}
	d := initialBackoff * time.Duration(math.Pow(2, float64(attempt-1)))
	if d > maxBackoff {
		return maxBackoff
	}
	return d
}

// RetryWithBackoff attempts to call fn with exponential backoff.
// If fn succeeds (returns nil), it returns immediately.
// Otherwise it retries up to maxAttempts times.
func RetryWithBackoff(maxAttempts int, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			d := BackoffDuration(attempt)
			slog.Debug("retrying after backoff", "attempt", attempt+1, "backoff", d)
			time.Sleep(d)
		}

		lastErr = fn()
		if lastErr == nil {
			return nil
		}
		slog.Warn("attempt failed", "attempt", attempt+1, "error", lastErr)
	}
	return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}
