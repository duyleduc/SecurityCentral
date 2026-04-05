package signing

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// VerifyResult represents the outcome of a binary signature verification.
type VerifyResult struct {
	Verified bool   // true if signature is valid
	Skipped  bool   // true if verification was skipped (no pubkey or unsigned build)
	Reason   string // human-readable explanation
}

// VerifySelf checks the signature of the currently running binary by
// fetching the checksum and signature from the API. Returns a result
// indicating whether verification succeeded, was skipped, or failed.
//
// This never blocks execution — it's informational.
func VerifySelf(apiURL, arch string) VerifyResult {
	pubKey := PublicKey()
	if pubKey == nil {
		return VerifyResult{Skipped: true, Reason: "unsigned dev build (no signing key embedded)"}
	}

	self, err := os.Executable()
	if err != nil {
		return VerifyResult{Skipped: true, Reason: fmt.Sprintf("cannot determine own path: %v", err)}
	}

	binaryData, err := os.ReadFile(self)
	if err != nil {
		return VerifyResult{Skipped: true, Reason: fmt.Sprintf("cannot read own binary: %v", err)}
	}

	actualChecksum := sha256.Sum256(binaryData)

	client := &http.Client{Timeout: 5 * time.Second}
	base := strings.TrimRight(apiURL, "/")

	// Fetch checksum
	checksumBody, err := quickGet(client, fmt.Sprintf("%s/v1/agents/download/checksum?arch=%s", base, arch))
	if err != nil {
		return VerifyResult{Skipped: true, Reason: fmt.Sprintf("cannot fetch checksum: %v", err)}
	}

	expectedHex := parseHex(checksumBody)
	actualHex := hex.EncodeToString(actualChecksum[:])
	if actualHex != expectedHex {
		return VerifyResult{Verified: false, Reason: fmt.Sprintf("SHA-256 mismatch: expected %s, got %s", expectedHex, actualHex)}
	}

	// Fetch signature
	sigBody, err := quickGet(client, fmt.Sprintf("%s/v1/agents/download/signature?arch=%s", base, arch))
	if err != nil {
		return VerifyResult{Skipped: true, Reason: fmt.Sprintf("cannot fetch signature: %v", err)}
	}

	if !ed25519.Verify(pubKey, actualChecksum[:], sigBody) {
		return VerifyResult{Verified: false, Reason: "Ed25519 signature verification failed"}
	}

	return VerifyResult{Verified: true, Reason: "signature verified"}
}

func quickGet(client *http.Client, url string) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func parseHex(data []byte) string {
	s := strings.TrimSpace(string(data))
	if idx := strings.IndexByte(s, ' '); idx > 0 {
		return s[:idx]
	}
	return s
}
