package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestConfigureResourceLimits(t *testing.T) {
	ConfigureResourceLimits()
	if got := runtime.GOMAXPROCS(0); got != 1 {
		t.Errorf("expected GOMAXPROCS=1, got %d", got)
	}
	// Restore for other tests
	runtime.GOMAXPROCS(runtime.NumCPU())
}

func TestRotatingWriter(t *testing.T) {
	dir := t.TempDir()
	w, err := NewRotatingWriter(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	// Override maxSize for testing
	w.maxSize = 100

	// Write enough to trigger rotation
	data := strings.Repeat("x", 60)
	w.Write([]byte(data)) // 60 bytes
	w.Write([]byte(data)) // 60 more → triggers rotate at 120 > 100

	// Should have rotated: test.log and test.log.1
	files, _ := filepath.Glob(filepath.Join(dir, "test.log*"))
	if len(files) < 2 {
		t.Errorf("expected at least 2 log files after rotation, got %d", len(files))
	}
}

func TestRotatingWriterPrunesOldFiles(t *testing.T) {
	dir := t.TempDir()
	w, err := NewRotatingWriter(dir, "test")
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	w.maxSize = 50
	w.maxFiles = 2

	// Write enough to trigger multiple rotations
	for i := 0; i < 10; i++ {
		w.Write([]byte(strings.Repeat("a", 60)))
	}

	// Should have at most maxFiles + 1 (current + maxFiles rotated)
	files, _ := filepath.Glob(filepath.Join(dir, "test.log*"))
	if len(files) > w.maxFiles+1 {
		t.Errorf("expected at most %d files, got %d", w.maxFiles+1, len(files))
	}
}

func TestVulnDBUpdater_CurrentVersion_Empty(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "vulndb.json")

	u := NewVulnDBUpdater(nil, "", dbPath)
	if v := u.CurrentVersion(); v != "" {
		t.Errorf("expected empty version, got %q", v)
	}
}

func TestVulnDBUpdater_CurrentVersion_Exists(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "vulndb.json")
	os.WriteFile(dbPath+".version", []byte("2024-06-01T00:00:00Z"), 0640)

	u := NewVulnDBUpdater(nil, "", dbPath)
	if v := u.CurrentVersion(); v != "2024-06-01T00:00:00Z" {
		t.Errorf("expected version, got %q", v)
	}
}
