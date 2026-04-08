// Package signing provides Ed25519 signature verification for agent binary
// integrity. The public key is injected at build time — it is never stored
// in source code.
package signing

import (
	"crypto/ed25519"
	"encoding/hex"
	"sync"
)

// publicKeyHex is set ONLY at build time via:
//
//	-ldflags="-X github.com/security-central/security-central/internal/signing.publicKeyHex=<hex>"
//
// It is deliberately unexported and defaults to empty. An empty value means
// the binary is an unsigned dev build and cannot verify signatures.
var publicKeyHex string

var (
	pubKeyOnce sync.Once
	pubKey     ed25519.PublicKey
)

// PublicKey returns the Ed25519 public key, or nil if none was embedded.
func PublicKey() ed25519.PublicKey {
	pubKeyOnce.Do(func() {
		if publicKeyHex == "" {
			return
		}
		decoded, err := hex.DecodeString(publicKeyHex)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return
		}
		pubKey = ed25519.PublicKey(decoded)
	})
	return pubKey
}

// IsSignedBuild returns true if a signing public key was embedded at build time.
func IsSignedBuild() bool {
	return PublicKey() != nil
}
