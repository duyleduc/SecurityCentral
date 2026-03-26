// Package compliance implements CIS benchmark compliance checks.
package compliance

import "context"

// CheckResult is the outcome of a single compliance check.
type CheckResult struct {
	Pass    bool
	Details string
	Fix     string
}

// Check is the interface for all CIS benchmark checks.
type Check interface {
	ID() string
	Title() string
	Level() int
	Run(ctx context.Context) (CheckResult, error)
}

// Registry holds all registered compliance checks.
var Registry []Check

// Register adds a check to the global registry.
func Register(c Check) {
	Registry = append(Registry, c)
}
