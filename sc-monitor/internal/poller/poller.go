package poller

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/securitycentral/sc-monitor/internal/checker"
	"github.com/securitycentral/sc-monitor/internal/config"
	"github.com/securitycentral/sc-monitor/internal/platform"
)

// connectionState tracks whether we're currently in a "down" state so we only
// log the first failure (and recovery) instead of spamming every poll.
type connectionState struct {
	down bool
}

// Run starts the polling loop. It blocks until ctx is cancelled.
func Run(ctx context.Context, cfg config.Config) error {
	client := platform.New(cfg.APIURL, cfg.APIKey)
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	state := &connectionState{}

	// Start a minimal health HTTP server (needed for Cloud Run).
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintln(w, "sc-monitor ok")
		})
		slog.Info("health server listening", "port", port)
		_ = http.ListenAndServe(":"+port, mux)
	}()

	slog.Info("monitor started", "apiUrl", cfg.APIURL, "poll", cfg.PollInterval, "concurrency", cfg.Concurrency)

	// Run immediately on start
	poll(client, cfg.Concurrency, state)

	for {
		select {
		case <-ctx.Done():
			slog.Info("monitor stopping")
			return nil
		case <-ticker.C:
			poll(client, cfg.Concurrency, state)
		}
	}
}

func poll(client *platform.Client, concurrency int, state *connectionState) {
	endpoints, err := client.GetDueEndpoints()
	if err != nil {
		// Only log the first failure to avoid spamming when the API is down.
		if !state.down {
			slog.Error("failed to get due endpoints — will retry silently until API recovers", "error", err)
			state.down = true
		}
		return
	}
	// Recovered from a previous failure → log once.
	if state.down {
		slog.Info("API connection recovered")
		state.down = false
	}

	if len(endpoints) == 0 {
		return
	}

	slog.Info("[poll] checking endpoints", "count", len(endpoints))

	// Worker pool
	sem := make(chan struct{}, concurrency)
	var mu sync.Mutex
	results := make([]platform.HeartbeatResult, 0, len(endpoints))
	var wg sync.WaitGroup

	for _, ep := range endpoints {
		wg.Add(1)
		sem <- struct{}{}
		go func(ep platform.Endpoint) {
			defer wg.Done()
			defer func() { <-sem }()

			slog.Debug("[check] start", "host", ep.Host, "id", ep.ID)
			result := checker.Check(ep)
			status := "UP"
			if !result.IsUp {
				status = "DOWN"
			}
			slog.Info("[check] done", "host", ep.Host, "status", status, "ms", result.ResponseMs, "code", result.StatusCode, "error", result.Error)

			mu.Lock()
			results = append(results, result)
			mu.Unlock()
		}(ep)
	}

	wg.Wait()

	// Post results
	if len(results) > 0 {
		slog.Debug("[post] sending heartbeats to API", "count", len(results))
		if err := client.PostHeartbeats(results); err != nil {
			slog.Error("[post] failed to send heartbeats", "error", err)
			return
		}

		upCount := 0
		for _, r := range results {
			if r.IsUp {
				upCount++
			}
		}
		slog.Info("[poll] complete", "total", len(results), "up", upCount, "down", len(results)-upCount)
	}
}
