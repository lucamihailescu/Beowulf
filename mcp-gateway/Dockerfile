FROM golang:1.24 AS builder
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/mcp-gateway ./main.go

FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=builder /out/mcp-gateway /app/mcp-gateway
EXPOSE 8090
ENTRYPOINT ["/app/mcp-gateway"]
