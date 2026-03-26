package secrets

import (
	"testing"

	"github.com/security-central/security-central/internal/config"
)

func TestBuildPatterns(t *testing.T) {
	patterns := BuildPatterns()

	if len(patterns) < 50 {
		t.Errorf("expected at least 50 patterns, got %d", len(patterns))
	}

	// Verify patterns compile (they already do since we use MustCompile,
	// but this confirms the function doesn't panic)
	for _, p := range patterns {
		if p.Name == "" {
			t.Error("pattern has empty name")
		}
		if p.Regex == nil {
			t.Errorf("pattern %q has nil regex", p.Name)
		}
	}
}

func TestShannonEntropy(t *testing.T) {
	tests := []struct {
		input    string
		minEntropy float64
		maxEntropy float64
	}{
		{"aaaa", 0, 0.1},                        // very low entropy
		{"abcdefghijklmnop", 3.5, 5.0},          // moderate entropy
		{"aB3$xY9!kL7@mN2#", 3.5, 5.0},          // high entropy
		{"AKIAIOSFODNN7EXAMPLE", 3.0, 5.0},       // AWS key pattern
		{"", 0, 0},                                // empty string
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			e := ShannonEntropy(tt.input)
			if e < tt.minEntropy || e > tt.maxEntropy {
				t.Errorf("ShannonEntropy(%q) = %f, want [%f, %f]", tt.input, e, tt.minEntropy, tt.maxEntropy)
			}
		})
	}
}

func TestCloudPatternDetection(t *testing.T) {
	patterns := BuildPatterns()

	tests := []struct {
		name    string
		input   string
		pattern string
		want    bool
	}{
		{"AWS Access Key", "AKIAIOSFODNN7EXAMPLE", "AWS Access Key", true},
		{"GCP API Key", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "GCP API Key", true},
		{"GitHub PAT", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", "GitHub PAT", true},
		{"Stripe Secret", "sk_live_ABCDEFGHIJKLMNOPQRSTUVWx", "Stripe Secret Key", true},
		{"RSA Private Key", "-----BEGIN RSA PRIVATE KEY-----", "RSA Private Key", true},
		{"No match", "this is just normal text", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			found := false
			for _, p := range patterns {
				if p.Regex.MatchString(tt.input) {
					if tt.pattern != "" && p.Name == tt.pattern {
						found = true
						break
					}
					if tt.pattern == "" {
						found = true
						break
					}
				}
			}
			if found != tt.want {
				t.Errorf("pattern match for %q: got %v, want %v", tt.name, found, tt.want)
			}
		})
	}
}

func TestIsAllowed(t *testing.T) {
	rules := []config.AllowRule{
		{Path: "docs/examples/*"},
		{Pattern: "EXAMPLE_.*"},
	}

	tests := []struct {
		file    string
		match   string
		want    bool
	}{
		{"docs/examples/test.py", "AKIAIOSFODNN7EXAMPLE", true},
		{"src/main.py", "EXAMPLE_KEY_12345678", true},
		{"src/main.py", "AKIAIOSFODNN7REAL123", false},
	}

	for _, tt := range tests {
		t.Run(tt.file+"/"+tt.match, func(t *testing.T) {
			got := IsAllowed(tt.file, tt.match, "test", rules)
			if got != tt.want {
				t.Errorf("IsAllowed(%q, %q) = %v, want %v", tt.file, tt.match, got, tt.want)
			}
		})
	}
}
