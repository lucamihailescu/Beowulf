#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

TMP_GRPC="$(mktemp)"
TMP_STORAGE="$(mktemp)"
cleanup() {
  rm -f "$TMP_GRPC" "$TMP_STORAGE"
}
trap cleanup EXIT

extract_ns_op() {
  bench_name="$1"
  file_path="$2"
  awk -v name="$bench_name" '
    $1 ~ "^"name"-" {
      for (i = 1; i <= NF; i++) {
        if ($i == "ns/op") {
          print $(i-1)
          exit
        }
      }
    }
  ' "$file_path"
}

assert_le() {
  metric="$1"
  value="$2"
  limit="$3"
  if [ -z "$value" ]; then
    echo "ERROR: missing benchmark value for $metric"
    exit 1
  fi
  if ! awk -v v="$value" -v l="$limit" 'BEGIN { exit (v <= l ? 0 : 1) }'; then
    echo "ERROR: $metric exceeded gate (value=${value}ns/op limit=${limit}ns/op)"
    exit 1
  fi
}

echo "Running gRPC performance benchmarks..."
go test ./internal/grpc -run '^$' -bench 'BenchmarkServer(Check|BatchCheck_100)$' -benchmem -count=1 > "$TMP_GRPC"

echo "Running cache performance benchmarks..."
go test ./internal/storage -run '^$' -bench 'BenchmarkCached(PolicyProvider|EntityProvider)(Warm|Cold)$' -benchmem -count=1 > "$TMP_STORAGE"

check_ns="$(extract_ns_op BenchmarkServerCheck "$TMP_GRPC")"
batch100_ns="$(extract_ns_op BenchmarkServerBatchCheck_100 "$TMP_GRPC")"
policy_warm_ns="$(extract_ns_op BenchmarkCachedPolicyProviderWarm "$TMP_STORAGE")"
policy_cold_ns="$(extract_ns_op BenchmarkCachedPolicyProviderCold "$TMP_STORAGE")"
entity_warm_ns="$(extract_ns_op BenchmarkCachedEntityProviderWarm "$TMP_STORAGE")"
entity_cold_ns="$(extract_ns_op BenchmarkCachedEntityProviderCold "$TMP_STORAGE")"

MAX_SERVER_CHECK_NS="${MAX_SERVER_CHECK_NS:-5000000}"
MAX_BATCH100_NS="${MAX_BATCH100_NS:-200000000}"
MAX_POLICY_WARM_NS="${MAX_POLICY_WARM_NS:-5000000}"
MAX_POLICY_COLD_NS="${MAX_POLICY_COLD_NS:-50000000}"
MAX_ENTITY_WARM_NS="${MAX_ENTITY_WARM_NS:-2000000}"
MAX_ENTITY_COLD_NS="${MAX_ENTITY_COLD_NS:-30000000}"

assert_le "BenchmarkServerCheck" "$check_ns" "$MAX_SERVER_CHECK_NS"
assert_le "BenchmarkServerBatchCheck_100" "$batch100_ns" "$MAX_BATCH100_NS"
assert_le "BenchmarkCachedPolicyProviderWarm" "$policy_warm_ns" "$MAX_POLICY_WARM_NS"
assert_le "BenchmarkCachedPolicyProviderCold" "$policy_cold_ns" "$MAX_POLICY_COLD_NS"
assert_le "BenchmarkCachedEntityProviderWarm" "$entity_warm_ns" "$MAX_ENTITY_WARM_NS"
assert_le "BenchmarkCachedEntityProviderCold" "$entity_cold_ns" "$MAX_ENTITY_COLD_NS"

echo "Performance gates passed."
echo "  BenchmarkServerCheck: ${check_ns} ns/op"
echo "  BenchmarkServerBatchCheck_100: ${batch100_ns} ns/op"
echo "  BenchmarkCachedPolicyProviderWarm: ${policy_warm_ns} ns/op"
echo "  BenchmarkCachedPolicyProviderCold: ${policy_cold_ns} ns/op"
echo "  BenchmarkCachedEntityProviderWarm: ${entity_warm_ns} ns/op"
echo "  BenchmarkCachedEntityProviderCold: ${entity_cold_ns} ns/op"
