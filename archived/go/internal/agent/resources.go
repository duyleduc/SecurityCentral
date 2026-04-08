package agent

import (
	"compress/gzip"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

const (
	logDir        = "/var/log/securitycentral"
	maxLogSize    = 5 * 1024 * 1024 // 5MB per file
	maxLogFiles   = 3
)

// ConfigureResourceLimits sets process-level resource constraints.
// - GOMAXPROCS(1): single OS thread for CPU friendliness
// - Intended to run under `nice 19` via systemd (Nice=19 in unit file)
func ConfigureResourceLimits() {
	runtime.GOMAXPROCS(1)
	slog.Info("resource limits configured", "GOMAXPROCS", 1)
}

// ---------------------------------------------------------------------------
// Log Rotation: 5MB × 3 files
// ---------------------------------------------------------------------------

// RotatingWriter is an io.Writer that rotates log files by size.
type RotatingWriter struct {
	dir      string
	prefix   string
	maxSize  int64
	maxFiles int
	current  *os.File
	written  int64
}

// NewRotatingWriter creates a log writer with rotation.
func NewRotatingWriter(dir, prefix string) (*RotatingWriter, error) {
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, err
	}
	w := &RotatingWriter{
		dir:      dir,
		prefix:   prefix,
		maxSize:  maxLogSize,
		maxFiles: maxLogFiles,
	}
	return w, w.openCurrent()
}

func (w *RotatingWriter) Write(p []byte) (n int, err error) {
	if w.written+int64(len(p)) > w.maxSize {
		if err := w.rotate(); err != nil {
			return 0, err
		}
	}
	n, err = w.current.Write(p)
	w.written += int64(n)
	return
}

// Close closes the current log file.
func (w *RotatingWriter) Close() error {
	if w.current != nil {
		return w.current.Close()
	}
	return nil
}

func (w *RotatingWriter) openCurrent() error {
	path := filepath.Join(w.dir, w.prefix+".log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0640)
	if err != nil {
		return err
	}
	info, _ := f.Stat()
	w.current = f
	if info != nil {
		w.written = info.Size()
	}
	return nil
}

func (w *RotatingWriter) rotate() error {
	if w.current != nil {
		w.current.Close()
	}

	basePath := filepath.Join(w.dir, w.prefix+".log")

	// Shift existing files: .log.2 → .log.3, .log.1 → .log.2, .log → .log.1
	for i := w.maxFiles - 1; i >= 1; i-- {
		src := basePath + "." + itoa(i)
		dst := basePath + "." + itoa(i+1)
		os.Rename(src, dst)
	}
	os.Rename(basePath, basePath+".1")

	// Remove files beyond maxFiles
	w.pruneOldFiles()

	w.written = 0
	return w.openCurrent()
}

func (w *RotatingWriter) pruneOldFiles() {
	pattern := filepath.Join(w.dir, w.prefix+".log.*")
	matches, _ := filepath.Glob(pattern)
	if len(matches) <= w.maxFiles {
		return
	}
	sort.Strings(matches)
	for _, m := range matches[w.maxFiles:] {
		os.Remove(m)
	}
}

func itoa(i int) string {
	return string(rune('0' + i))
}

// ---------------------------------------------------------------------------
// Gzip Compression for HTTP Requests
// ---------------------------------------------------------------------------

// GzipTransport wraps an http.RoundTripper to add gzip compression to request bodies
// and Accept-Encoding for responses.
type GzipTransport struct {
	Base http.RoundTripper
}

// RoundTrip adds Accept-Encoding: gzip to all requests.
func (t *GzipTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.Header.Set("Accept-Encoding", "gzip")
	return t.Base.RoundTrip(req)
}

// NewGzipWriter wraps a writer to produce gzip-compressed output.
func NewGzipWriter(w io.Writer) *gzip.Writer {
	gz, _ := gzip.NewWriterLevel(w, gzip.BestSpeed)
	return gz
}
