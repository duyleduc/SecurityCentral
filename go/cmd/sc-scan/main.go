// sc-scan is the SecurityCentral Code Scanner CLI.
// It scans dependencies and source code for vulnerabilities and secrets.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("sc-scan: SecurityCentral Code Scanner")
	fmt.Printf("Version: %s\n", version)
	os.Exit(0)
}

var version = "dev"
