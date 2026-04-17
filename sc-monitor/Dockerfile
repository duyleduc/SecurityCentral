FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o sc-monitor ./cmd/sc-monitor

# --- Production ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/sc-monitor /usr/local/bin/sc-monitor
ENTRYPOINT ["sc-monitor"]
