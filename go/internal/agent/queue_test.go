package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tempQueueDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "queue")
	return dir
}

func TestNewOfflineQueue(t *testing.T) {
	dir := tempQueueDir(t)
	q, err := NewOfflineQueue(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q == nil {
		t.Fatal("expected non-nil queue")
	}
	// Directory should exist
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Error("expected queue directory to be created")
	}
}

func TestEnqueueAndDrain(t *testing.T) {
	q, err := NewOfflineQueue(tempQueueDir(t))
	if err != nil {
		t.Fatal(err)
	}

	// Enqueue 3 items
	for i := 0; i < 3; i++ {
		payload := json.RawMessage(`{"scan_id":"s` + string(rune('1'+i)) + `"}`)
		if err := q.Enqueue(payload); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
		time.Sleep(time.Millisecond) // ensure unique timestamps
	}

	if q.Size() != 3 {
		t.Errorf("expected size=3, got %d", q.Size())
	}

	// Drain
	entries, err := q.Drain()
	if err != nil {
		t.Fatalf("drain: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	// Verify FIFO order
	if string(entries[0].Payload) != `{"scan_id":"s1"}` {
		t.Errorf("expected first entry s1, got %s", entries[0].Payload)
	}

	// Queue should be empty after drain
	if !q.IsEmpty() {
		t.Error("expected empty queue after drain")
	}
}

func TestEnqueueDropsOldestAtCapacity(t *testing.T) {
	q, err := NewOfflineQueue(tempQueueDir(t))
	if err != nil {
		t.Fatal(err)
	}

	// Fill queue to capacity
	for i := 0; i < maxQueueSize; i++ {
		payload := json.RawMessage(`{"i":` + string(rune('0'+i%10)) + `}`)
		q.Enqueue(payload)
		time.Sleep(time.Millisecond)
	}

	if q.Size() != maxQueueSize {
		t.Errorf("expected size=%d, got %d", maxQueueSize, q.Size())
	}

	// Enqueue one more — should drop oldest
	q.Enqueue(json.RawMessage(`{"i":"new"}`))

	if q.Size() != maxQueueSize {
		t.Errorf("expected size to remain %d after overflow, got %d", maxQueueSize, q.Size())
	}
}

func TestDrainEmptyQueue(t *testing.T) {
	q, err := NewOfflineQueue(tempQueueDir(t))
	if err != nil {
		t.Fatal(err)
	}

	entries, err := q.Drain()
	if err != nil {
		t.Fatalf("drain: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries from empty queue, got %d", len(entries))
	}
}

func TestBackoffDuration(t *testing.T) {
	tests := []struct {
		attempt int
		min     time.Duration
		max     time.Duration
	}{
		{0, 1 * time.Second, 1 * time.Second},
		{1, 1 * time.Second, 1 * time.Second},
		{2, 2 * time.Second, 2 * time.Second},
		{3, 4 * time.Second, 4 * time.Second},
		{4, 8 * time.Second, 8 * time.Second},
		{20, 5 * time.Minute, 5 * time.Minute}, // capped at maxBackoff
	}

	for _, tt := range tests {
		d := BackoffDuration(tt.attempt)
		if d < tt.min || d > tt.max {
			t.Errorf("BackoffDuration(%d) = %v, want [%v, %v]", tt.attempt, d, tt.min, tt.max)
		}
	}
}

func TestRetryWithBackoff_SucceedsOnFirstAttempt(t *testing.T) {
	calls := 0
	err := RetryWithBackoff(3, func() error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

func TestRetryWithBackoff_SucceedsOnRetry(t *testing.T) {
	calls := 0
	err := RetryWithBackoff(3, func() error {
		calls++
		if calls < 3 {
			return os.ErrClosed
		}
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 3 {
		t.Errorf("expected 3 calls, got %d", calls)
	}
}
