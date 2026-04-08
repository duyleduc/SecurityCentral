// Package incremental provides git-based changed file detection for incremental scanning.
package incremental

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// ChangedFiles returns the list of files changed since the last commit (or base branch).
// Falls back to returning nil (full scan) if git is not available.
func ChangedFiles(repoPath string) ([]string, error) {
	// Try diff against HEAD~1 first
	out, err := runGit(repoPath, "diff", "--name-only", "HEAD~1")
	if err != nil {
		// Fallback: diff against main/master
		out, err = runGit(repoPath, "diff", "--name-only", "origin/main...HEAD")
		if err != nil {
			return nil, nil // fall back to full scan
		}
	}

	lines := strings.Split(strings.TrimSpace(out), "\n")
	var files []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			files = append(files, filepath.Join(repoPath, line))
		}
	}

	return files, nil
}

// FilterFiles returns only the paths that exist in the changedFiles set.
// If changedFiles is nil (full scan mode), returns all paths unchanged.
func FilterFiles(allFiles []string, changedFiles []string) []string {
	if changedFiles == nil {
		return allFiles
	}

	changed := make(map[string]bool, len(changedFiles))
	for _, f := range changedFiles {
		changed[f] = true
	}

	var filtered []string
	for _, f := range allFiles {
		if changed[f] {
			filtered = append(filtered, f)
		}
	}
	return filtered
}

// HasLockfileChanged checks if any lockfile was changed (triggers full dep scan even in incremental mode).
func HasLockfileChanged(changedFiles []string) bool {
	lockfiles := map[string]bool{
		"package-lock.json": true, "yarn.lock": true, "pnpm-lock.yaml": true,
		"requirements.txt": true, "Pipfile.lock": true, "poetry.lock": true,
		"pom.xml": true, "gradle.lockfile": true,
	}

	for _, f := range changedFiles {
		if lockfiles[filepath.Base(f)] {
			return true
		}
	}
	return false
}

func runGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
