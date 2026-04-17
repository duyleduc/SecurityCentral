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

// Run starts the polling loop. It blocks until ctx is cancelled.
func Run(ctx context.Context, cfg config.Config) error {
	client := platform.New(cfg.APIURL, cfg.APIKey)
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()

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
	poll(client, cfg.Concurrency)

	for {
		select {
		case <-ctx.Done():
			slog.Info("monitor stopping")
			return nil
		case <-ticker.C:
			poll(client, cfg.Concurrency)
		}
	}
}

func poll(client *platform.Client, concurrency int) {
	endpoints, err := client.GetDueEndpoints()
	if err != nil {
		slog.Error("failed to get due endpoints", "error", err)
		return
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
