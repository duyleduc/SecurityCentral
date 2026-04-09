.PHONY: build build-linux test clean

build:
	go build -o bin/sc-agent ./cmd/sc-agent

build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/sc-agent-linux-amd64 ./cmd/sc-agent
	GOOS=linux GOARCH=arm64 go build -o bin/sc-agent-linux-arm64 ./cmd/sc-agent

test:
	go test ./...

clean:
	rm -rf bin/
