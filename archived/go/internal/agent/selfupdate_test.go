package agent

import "testing"

func TestCompareSemver(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"1.0.0", "1.0.1", -1},
		{"1.0.1", "1.0.0", 1},
		{"1.1.0", "1.0.9", 1},
		{"2.0.0", "1.9.9", 1},
		{"1.0.0", "2.0.0", -1},
		{"v1.1.0", "1.1.0", 0},  // v prefix
		{"1.1.0", "v1.1.0", 0},  // v prefix on other
		{"dev", "1.0.0", -1},    // non-numeric = 0.0.0
		{"1.0.0", "dev", 1},     // non-numeric = 0.0.0
		{"1.2", "1.2.0", 0},     // missing patch
		{"1", "1.0.0", 0},       // missing minor+patch
		{"1.0.0-beta", "1.0.0", 0}, // pre-release stripped
	}

	for _, tt := range tests {
		got := compareSemver(tt.a, tt.b)
		if got != tt.want {
			t.Errorf("compareSemver(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}

func TestParseSemver(t *testing.T) {
	tests := []struct {
		input string
		want  [3]int
	}{
		{"1.2.3", [3]int{1, 2, 3}},
		{"v1.2.3", [3]int{1, 2, 3}},
		{"1.0", [3]int{1, 0, 0}},
		{"dev", [3]int{0, 0, 0}},
		{"1.2.3-beta", [3]int{1, 2, 3}},
	}

	for _, tt := range tests {
		got := parseSemver(tt.input)
		if got != tt.want {
			t.Errorf("parseSemver(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
