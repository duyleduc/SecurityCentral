// sc-sign is a standalone build-time tool for signing and verifying sc-agent
// binaries using Ed25519. It lives outside the agent source tree and has zero
// dependencies beyond the Go standard library.
//
// It is NOT shipped to customers — only used in CI/CD and local builds.
//
// Usage:
//
//	sc-sign keygen  [-o <dir>]              Generate Ed25519 keypair
//	sc-sign sign    -key <privkey> <file>   Sign a binary → .sha256 + .sig
//	sc-sign verify  -pub <pubkey>  <file>   Verify a signed binary → exit 0 or 1
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "keygen":
		cmdKeygen(os.Args[2:])
	case "sign":
		cmdSign(os.Args[2:])
	case "verify":
		cmdVerify(os.Args[2:])
	case "-h", "--help", "help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`sc-sign — Ed25519 binary signing tool (build-time only)

Commands:
  keygen  [-o dir]            Generate Ed25519 keypair
  sign    -key <privkey> file Sign a binary (produces .sha256 + .sig)
  verify  -pub <pubkey>  file Verify a signed binary (exit 0=ok, 1=fail)`)
}

// ---------------------------------------------------------------------------
// keygen
// ---------------------------------------------------------------------------

func cmdKeygen(args []string) {
	fs := flag.NewFlagSet("keygen", flag.ExitOnError)
	outDir := fs.String("o", ".", "Output directory for keypair")
	fs.Parse(args)

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fatal("generate key: %v", err)
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "ED25519 PRIVATE KEY",
		Bytes: priv.Seed(),
	})
	privPath := filepath.Join(*outDir, "agent-signing.key")
	if err := os.WriteFile(privPath, privPEM, 0600); err != nil {
		fatal("write private key: %v", err)
	}

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "ED25519 PUBLIC KEY",
		Bytes: pub,
	})
	pubPath := filepath.Join(*outDir, "agent-signing.pub")
	if err := os.WriteFile(pubPath, pubPEM, 0644); err != nil {
		fatal("write public key: %v", err)
	}

	fmt.Printf("Private key: %s\n", privPath)
	fmt.Printf("Public key:  %s\n", pubPath)
	fmt.Printf("\nPublic key (hex, for -ldflags): %s\n", hex.EncodeToString(pub))
	fmt.Println("\nStore the private key in CI secrets. NEVER commit it to the repository.")
}

// ---------------------------------------------------------------------------
// sign
// ---------------------------------------------------------------------------

func cmdSign(args []string) {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	keyPath := fs.String("key", "", "Path to Ed25519 private key (PEM)")
	fs.Parse(args)

	if *keyPath == "" || fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: sc-sign sign -key <privkey> <binary-file>")
		os.Exit(1)
	}
	binaryPath := fs.Arg(0)

	privKey := loadPrivateKey(*keyPath)

	binaryData, err := os.ReadFile(binaryPath)
	if err != nil {
		fatal("read binary: %v", err)
	}

	checksum := sha256.Sum256(binaryData)
	checksumHex := hex.EncodeToString(checksum[:])

	// Write .sha256 (sha256sum compatible format)
	checksumContent := fmt.Sprintf("%s  %s\n", checksumHex, filepath.Base(binaryPath))
	checksumPath := binaryPath + ".sha256"
	if err := os.WriteFile(checksumPath, []byte(checksumContent), 0644); err != nil {
		fatal("write checksum: %v", err)
	}

	// Sign the raw checksum bytes (not the hex string)
	signature := ed25519.Sign(privKey, checksum[:])

	sigPath := binaryPath + ".sig"
	if err := os.WriteFile(sigPath, signature, 0644); err != nil {
		fatal("write signature: %v", err)
	}

	fmt.Printf("Signed: %s\n", binaryPath)
	fmt.Printf("  SHA-256:   %s\n", checksumHex)
	fmt.Printf("  Checksum:  %s\n", checksumPath)
	fmt.Printf("  Signature: %s\n", sigPath)
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

func cmdVerify(args []string) {
	fs := flag.NewFlagSet("verify", flag.ExitOnError)
	pubPath := fs.String("pub", "", "Path to Ed25519 public key (PEM)")
	fs.Parse(args)

	if *pubPath == "" || fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: sc-sign verify -pub <pubkey> <binary-file>")
		os.Exit(1)
	}
	binaryPath := fs.Arg(0)

	pubKey := loadPublicKey(*pubPath)

	if err := VerifyBinary(binaryPath, pubKey); err != nil {
		fmt.Fprintf(os.Stderr, "FAILED: %s\n", err)
		os.Exit(1)
	}

	fmt.Println("OK: signature verified")
}

// VerifyBinary checks SHA-256 checksum and Ed25519 signature of a binary.
func VerifyBinary(binaryPath string, pubKey ed25519.PublicKey) error {
	binaryData, err := os.ReadFile(binaryPath)
	if err != nil {
		return fmt.Errorf("read binary: %w", err)
	}

	checksum := sha256.Sum256(binaryData)

	// Read and compare .sha256
	checksumData, err := os.ReadFile(binaryPath + ".sha256")
	if err != nil {
		return fmt.Errorf("read checksum file: %w", err)
	}

	expectedHex := parseChecksumHex(checksumData)
	actualHex := hex.EncodeToString(checksum[:])
	if actualHex != expectedHex {
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", expectedHex, actualHex)
	}

	// Read and verify .sig
	signature, err := os.ReadFile(binaryPath + ".sig")
	if err != nil {
		return fmt.Errorf("read signature file: %w", err)
	}

	if !ed25519.Verify(pubKey, checksum[:], signature) {
		return fmt.Errorf("Ed25519 signature verification failed")
	}

	return nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func parseChecksumHex(data []byte) string {
	for i, b := range data {
		if b == ' ' || b == '\n' || b == '\t' {
			return string(data[:i])
		}
	}
	return string(data)
}

func loadPrivateKey(path string) ed25519.PrivateKey {
	data, err := os.ReadFile(path)
	if err != nil {
		fatal("read private key: %v", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		fatal("no PEM block in %s", path)
	}
	if len(block.Bytes) != ed25519.SeedSize {
		fatal("invalid seed size: got %d, want %d", len(block.Bytes), ed25519.SeedSize)
	}
	return ed25519.NewKeyFromSeed(block.Bytes)
}

func loadPublicKey(path string) ed25519.PublicKey {
	data, err := os.ReadFile(path)
	if err != nil {
		fatal("read public key: %v", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		fatal("no PEM block in %s", path)
	}
	if len(block.Bytes) != ed25519.PublicKeySize {
		fatal("invalid public key size: got %d, want %d", len(block.Bytes), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(block.Bytes)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "sc-sign: "+format+"\n", args...)
	os.Exit(1)
}
