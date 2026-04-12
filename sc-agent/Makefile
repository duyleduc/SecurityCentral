.PHONY: build build-linux test clean

# Version is read from VERSION file, git tag, or defaults to "dev"
VERSION ?= $(shell cat VERSION 2>/dev/null || git describe --tags --always 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-X main.version=$(VERSION)"

build:
	go build $(LDFLAGS) -o bin/sc-agent ./cmd/sc-agent

build-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/sc-agent-linux-arm64 ./cmd/sc-agent

test:
	go test -race ./...

clean:
	rm -rf bin/

# Create a release: set VERSION, build, tag
release:
	@test -n "$(V)" || (echo "Usage: make release V=1.2.3" && exit 1)
	echo "$(V)" > VERSION
	$(MAKE) build-linux VERSION=$(V)
	@echo "Built sc-agent $(V) for linux/amd64 + linux/arm64"
	@echo "Binaries in bin/"
