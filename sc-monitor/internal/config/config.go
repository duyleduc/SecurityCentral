package config

import "time"

type Config struct {
	APIURL       string
	APIKey       string
	PollInterval time.Duration
	Concurrency  int
	Verbose      bool
}
