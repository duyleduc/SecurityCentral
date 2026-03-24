// sc-agent is the SecurityCentral Infrastructure Agent.
// It runs on target servers to scan for OS vulnerabilities and misconfigurations.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("sc-agent: SecurityCentral Infrastructure Agent")
	fmt.Printf("Version: %s\n", version)
	os.Exit(0)
}

var version = "dev"
