FROM golang:1.24.1 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download && go mod verify
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go vet ./...
ARG GIT_COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X main.GitCommit=${GIT_COMMIT}" -o server ./cmd/server

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/server ./server
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
USER nonroot:nonroot
EXPOSE 8080
CMD ["./server"]
