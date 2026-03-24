// sc-certmon is the SecurityCentral Certificate Monitor.
// It discovers and monitors TLS certificates for expiration and chain validity.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("sc-certmon: SecurityCentral Certificate Monitor")
	fmt.Printf("Version: %s\n", version)
	os.Exit(0)
}

var version = "dev"
