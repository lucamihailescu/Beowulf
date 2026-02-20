# Backend Performance Validation

Use these commands to validate performance after each optimization phase.

## Run Microbenchmarks

```bash
cd backend
go test ./internal/grpc -run '^$' -bench 'BenchmarkServer(Check|BatchCheck_100)$' -benchmem -count=1
go test ./internal/storage -run '^$' -bench 'BenchmarkCached(PolicyProvider|EntityProvider)(Warm|Cold)$' -benchmem -count=1
```

## Run Gate Checks

```bash
cd backend
sh ./scripts/perf_gate.sh
```

The gate script fails if any benchmark exceeds thresholds. Override thresholds with env vars when needed:

- `MAX_SERVER_CHECK_NS`
- `MAX_BATCH100_NS`
- `MAX_POLICY_WARM_NS`
- `MAX_POLICY_COLD_NS`
- `MAX_ENTITY_WARM_NS`
- `MAX_ENTITY_COLD_NS`

Example:

```bash
MAX_BATCH100_NS=250000000 sh ./scripts/perf_gate.sh
```
