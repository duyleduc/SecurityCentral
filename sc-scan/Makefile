.PHONY: build test clean

build:
	go build -o bin/sc-scan ./cmd/sc-scan

build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/sc-scan-linux-amd64 ./cmd/sc-scan
	GOOS=linux GOARCH=arm64 go build -o bin/sc-scan-linux-arm64 ./cmd/sc-scan

build-all:
	GOOS=linux GOARCH=amd64 go build -o bin/sc-scan-linux-amd64 ./cmd/sc-scan
	GOOS=linux GOARCH=arm64 go build -o bin/sc-scan-linux-arm64 ./cmd/sc-scan
	GOOS=darwin GOARCH=amd64 go build -o bin/sc-scan-darwin-amd64 ./cmd/sc-scan
	GOOS=darwin GOARCH=arm64 go build -o bin/sc-scan-darwin-arm64 ./cmd/sc-scan

test:
	go test -race ./...

clean:
	rm -rf bin/
