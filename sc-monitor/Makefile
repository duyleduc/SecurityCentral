.PHONY: build build-linux test clean

build:
	go build -o bin/sc-monitor ./cmd/sc-monitor

build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/sc-monitor-linux-amd64 ./cmd/sc-monitor
	GOOS=linux GOARCH=arm64 go build -o bin/sc-monitor-linux-arm64 ./cmd/sc-monitor

test:
	go test -race ./...

clean:
	rm -rf bin/
