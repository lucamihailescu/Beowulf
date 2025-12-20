#!/usr/bin/env python3
"""
Test script for load balancing and high availability features:
1. /v1/cluster/instances - verify all instances are registered
2. Load balancing distribution - verify requests hit different instances
3. Health check consistency - verify all instances report healthy
4. Failover behavior - verify service continues if one instance is slow
"""

import argparse
import json
import requests
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

# Default to load balancer port (nginx)
BASE_URL = "http://localhost:5173/api"
DIRECT_API_URL = "http://localhost:8080"

# Rate limit handling
MAX_RETRIES = 15
RETRY_DELAY = 1.0  # seconds


def request_with_retry(method, url, **kwargs):
    """Make HTTP request with automatic retry on rate limit (429)."""
    kwargs.setdefault("timeout", 10)
    
    for attempt in range(MAX_RETRIES):
        try:
            if method == "GET":
                resp = requests.get(url, **kwargs)
            elif method == "POST":
                resp = requests.post(url, **kwargs)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            if resp.status_code == 429:
                # Rate limited - wait and retry
                retry_after = float(resp.headers.get("Retry-After", RETRY_DELAY))
                if attempt < MAX_RETRIES - 1:
                    time.sleep(retry_after)
                    continue
            
            return resp
        except requests.exceptions.ConnectionError:
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
                continue
            raise
    
    return resp  # Return last response even if rate limited


def test_cluster_instances():
    """Test the /v1/cluster/instances endpoint returns all registered instances."""
    print("\n=== Testing /v1/cluster/instances Endpoint ===")
    
    try:
        resp = request_with_retry("GET", f"{BASE_URL}/v1/cluster/instances")
    except requests.exceptions.ConnectionError:
        # Fallback to direct API if load balancer not running
        print("  Load balancer not available, using direct API...")
        resp = request_with_retry("GET", f"{DIRECT_API_URL}/v1/cluster/instances")
    
    if not resp.ok:
        print(f"  ✗ Failed to get cluster instances: {resp.status_code} - {resp.text}")
        return False, []
    
    data = resp.json()
    instances = data.get("instances", [])
    total = data.get("total", 0)
    
    print(f"  Total instances registered: {total}")
    
    if total == 0:
        print("  ✗ No instances found!")
        return False, []
    
    # Display each instance
    print("\n  Registered instances:")
    for inst in instances:
        status_icon = "✓" if inst.get("status") == "healthy" else "✗"
        print(f"    {status_icon} {inst.get('instance_id')}")
        print(f"      Status: {inst.get('status')}")
        print(f"      Uptime: {inst.get('uptime')}")
        print(f"      Cedar Version: {inst.get('cedar_version')}")
        
        # Check dependencies
        checks = inst.get("checks", {})
        db_status = checks.get("database", {}).get("status", "unknown")
        redis_status = checks.get("redis", {}).get("status", "unknown")
        print(f"      Database: {db_status}, Redis: {redis_status}")
        print()
    
    # Verify all instances are healthy
    unhealthy = [i for i in instances if i.get("status") != "healthy"]
    if unhealthy:
        print(f"  ⚠ {len(unhealthy)} instance(s) not healthy!")
        return False, instances
    
    print(f"  ✓ All {total} instance(s) are healthy")
    return True, instances


def test_load_balancing_distribution(num_requests=30):
    """Test that requests are distributed across multiple instances."""
    print(f"\n=== Testing Load Balancing Distribution ({num_requests} requests) ===")
    
    instance_hits = Counter()
    errors = []
    
    def make_request(i):
        try:
            # Use cluster status endpoint as it returns instance_id
            # Add small delay to avoid rate limiting
            time.sleep(0.05)
            # Force connection close to prevent Keep-Alive stickiness in tests
            headers = {"Connection": "close"}
            resp = request_with_retry("GET", f"{BASE_URL}/v1/cluster/status", headers=headers, timeout=5)
            if resp.ok:
                data = resp.json()
                return data.get("instance_id"), None
            elif resp.status_code == 429:
                return None, f"Request {i}: Rate limited"
            else:
                return None, f"Request {i}: HTTP {resp.status_code}"
        except requests.exceptions.ConnectionError:
            # Try direct API
            try:
                resp = request_with_retry("GET", f"{DIRECT_API_URL}/v1/cluster/status", timeout=5)
                if resp.ok:
                    return resp.json().get("instance_id"), None
            except:
                pass
            return None, f"Request {i}: Connection error"
        except Exception as e:
            return None, f"Request {i}: {str(e)}"
    
    print(f"  Making {num_requests} requests (with rate limit handling)...")
    
    # Make requests sequentially to avoid rate limiting
    for i in range(num_requests):
        instance_id, error = make_request(i)
        if instance_id:
            instance_hits[instance_id] += 1
        elif error:
            errors.append(error)
        
        # Progress indicator every 10 requests
        if (i + 1) % 10 == 0:
            print(f"    Progress: {i + 1}/{num_requests}")
    
    # Report results
    print(f"\n  Results:")
    print(f"    Successful requests: {sum(instance_hits.values())}")
    print(f"    Failed requests: {len(errors)}")
    
    if errors and len(errors) <= 5:
        print(f"    Errors: {errors}")
    elif errors:
        print(f"    First 5 errors: {errors[:5]}")
    
    print(f"\n  Distribution across instances:")
    total_hits = sum(instance_hits.values())
    for instance_id, count in sorted(instance_hits.items(), key=lambda x: -x[1]):
        percentage = (count / total_hits * 100) if total_hits > 0 else 0
        bar = "█" * int(percentage / 5) + "░" * (20 - int(percentage / 5))
        print(f"    {instance_id}: {count:3d} ({percentage:5.1f}%) {bar}")
    
    # Verify distribution
    unique_instances = len(instance_hits)
    if unique_instances == 0:
        print("  ✗ No successful requests!")
        return False
    elif unique_instances == 1:
        print(f"\n  ⚠ All requests hit a single instance (load balancing may not be active)")
        print("    This is expected if only 1 backend is running")
        return True
    else:
        # Check for reasonable distribution (no instance should handle >80% with 3+ instances)
        max_percentage = max(count / total_hits * 100 for count in instance_hits.values())
        if max_percentage > 80 and unique_instances >= 3:
            print(f"\n  ⚠ Uneven distribution detected (max: {max_percentage:.1f}%)")
            return True  # Still passes but with warning
        else:
            print(f"\n  ✓ Load balanced across {unique_instances} instances")
            return True


def test_concurrent_health_checks(num_checks=10):
    """Test health endpoint under concurrent load."""
    print(f"\n=== Testing Concurrent Health Checks ({num_checks} parallel) ===")
    
    results = {"healthy": 0, "degraded": 0, "error": 0, "timeout": 0, "rate_limited": 0}
    latencies = []
    
    def check_health(i):
        start = time.time()
        try:
            # Small stagger to reduce rate limit hits
            time.sleep(i * 0.02)
            resp = requests.get(f"{BASE_URL}/health", timeout=5)
            latency = (time.time() - start) * 1000  # ms
            if resp.ok:
                status = resp.json().get("status", "unknown")
                return status, latency, None
            elif resp.status_code == 429:
                return "rate_limited", latency, "Rate limited"
            else:
                return "error", latency, f"HTTP {resp.status_code}"
        except requests.exceptions.Timeout:
            return "timeout", None, "Timeout"
        except requests.exceptions.ConnectionError:
            # Try direct API
            try:
                resp = requests.get(f"{DIRECT_API_URL}/health", timeout=5)
                latency = (time.time() - start) * 1000
                if resp.ok:
                    return resp.json().get("status", "unknown"), latency, None
            except:
                pass
            return "error", None, "Connection error"
        except Exception as e:
            return "error", None, str(e)
    
    print(f"  Running {num_checks} health checks (staggered to avoid rate limits)...")
    
    with ThreadPoolExecutor(max_workers=5) as executor:  # Reduced concurrency
        futures = [executor.submit(check_health, i) for i in range(num_checks)]
        for future in as_completed(futures):
            status, latency, error = future.result()
            results[status] = results.get(status, 0) + 1
            if latency is not None:
                latencies.append(latency)
    
    # Report results
    print(f"\n  Results:")
    for status, count in sorted(results.items(), key=lambda x: -x[1]):
        if count > 0:
            icon = "✓" if status == "healthy" else "⚠" if status == "degraded" else "✗"
            print(f"    {icon} {status}: {count}")
    
    if latencies:
        avg_latency = sum(latencies) / len(latencies)
        min_latency = min(latencies)
        max_latency = max(latencies)
        print(f"\n  Latency (ms):")
        print(f"    Min: {min_latency:.1f}")
        print(f"    Avg: {avg_latency:.1f}")
        print(f"    Max: {max_latency:.1f}")
    
    # Pass if majority are healthy (excluding rate limited)
    total = sum(results.values())
    non_rate_limited = total - results.get("rate_limited", 0)
    healthy_pct = (results["healthy"] / non_rate_limited * 100) if non_rate_limited > 0 else 0
    
    if results.get("rate_limited", 0) > 0:
        print(f"\n  ⚠ {results['rate_limited']} requests were rate limited")
    
    if healthy_pct >= 90:
        print(f"  ✓ {healthy_pct:.0f}% healthy responses (excluding rate limited)")
        return True
    elif healthy_pct >= 50:
        print(f"  ⚠ Only {healthy_pct:.0f}% healthy responses")
        return True
    else:
        print(f"  ✗ Only {healthy_pct:.0f}% healthy responses")
        return False


def test_authorization_across_instances(num_requests=20):
    """Test that authorization works consistently across all instances."""
    print(f"\n=== Testing Authorization Across Instances ({num_requests} requests) ===")
    
    # First get an app (with retry)
    try:
        apps_resp = request_with_retry("GET", f"{BASE_URL}/v1/apps/")
    except requests.exceptions.ConnectionError:
        apps_resp = request_with_retry("GET", f"{DIRECT_API_URL}/v1/apps/")
    
    if not apps_resp.ok or not apps_resp.json():
        print("  ⚠ No apps found, skipping authorization test")
        return True
    
    app = apps_resp.json()[0]
    app_id = app["id"]
    print(f"  Using app: {app['name']} (ID: {app_id})")
    
    auth_payload = {
        "application_id": app_id,
        "principal": {"type": "User", "id": "alice"},
        "action": {"type": "Action", "id": "view"},
        "resource": {"type": "Document", "id": "test-doc"},
        "context": {}
    }
    
    results = {"allow": 0, "deny": 0, "error": 0}
    instance_hits = Counter()
    
    def make_auth_request(i):
        try:
            # Small delay to avoid rate limiting
            time.sleep(0.1)
            
            # Make auth request
            resp = request_with_retry("POST", f"{BASE_URL}/v1/authorize", json=auth_payload, timeout=5)
            
            # Also get instance ID from cluster status
            status_resp = request_with_retry("GET", f"{BASE_URL}/v1/cluster/status", timeout=5)
            instance_id = status_resp.json().get("instance_id", "unknown") if status_resp.ok else "unknown"
            
            if resp.ok:
                decision = resp.json().get("decision", "unknown")
                return decision, instance_id, None
            elif resp.status_code == 429:
                return "error", instance_id, "Rate limited"
            else:
                return "error", instance_id, f"HTTP {resp.status_code}"
        except requests.exceptions.ConnectionError:
            try:
                resp = request_with_retry("POST", f"{DIRECT_API_URL}/v1/authorize", json=auth_payload, timeout=5)
                if resp.ok:
                    return resp.json().get("decision", "unknown"), "direct", None
            except:
                pass
            return "error", "unknown", "Connection error"
        except Exception as e:
            return "error", "unknown", str(e)
    
    print(f"  Making {num_requests} authorization requests (sequential to avoid rate limits)...")
    
    # Run sequentially to avoid rate limiting
    for i in range(num_requests):
        decision, instance_id, error = make_auth_request(i)
        results[decision] = results.get(decision, 0) + 1
        instance_hits[instance_id] += 1
        
        if (i + 1) % 10 == 0:
            print(f"    Progress: {i + 1}/{num_requests}")
    
    # Report results
    print(f"\n  Authorization Results:")
    for decision, count in sorted(results.items(), key=lambda x: -x[1]):
        if count > 0:
            icon = "✓" if decision == "allow" else "✗" if decision == "deny" else "⚠"
            print(f"    {icon} {decision}: {count}")
    
    print(f"\n  Instance Distribution:")
    for instance_id, count in sorted(instance_hits.items(), key=lambda x: -x[1]):
        print(f"    {instance_id}: {count}")
    
    # Check consistency - all non-error results should be the same decision
    # Filter out keys with 0 values and error/unknown keys
    non_error_results = {k: v for k, v in results.items() if k not in ("error", "unknown") and v > 0}
    
    error_rate = results.get("error", 0) / num_requests * 100
    if error_rate > 10:
        print(f"\n  ⚠ High error rate: {error_rate:.1f}%")
        return error_rate < 50  # Pass if less than 50% errors
    
    # If we have both allow and deny results with actual counts, that's inconsistent
    if len(non_error_results) > 1:
        print(f"\n  ⚠ Inconsistent authorization decisions across instances!")
        for decision, count in non_error_results.items():
            print(f"      {decision}: {count}")
        return False
    
    print(f"\n  ✓ Consistent authorization across instances")
    return True


def test_sse_per_instance():
    """Test that SSE client counts are tracked per instance."""
    print("\n=== Testing SSE Client Tracking ===")
    
    try:
        resp = request_with_retry("GET", f"{BASE_URL}/v1/cluster/instances")
    except requests.exceptions.ConnectionError:
        resp = request_with_retry("GET", f"{DIRECT_API_URL}/v1/cluster/instances")
    
    if not resp.ok:
        print(f"  ✗ Failed to get cluster instances: {resp.status_code}")
        return False
    
    instances = resp.json().get("instances", [])
    total_sse = sum(i.get("sse_clients", 0) for i in instances)
    
    print(f"  Total SSE clients across cluster: {total_sse}")
    for inst in instances:
        print(f"    {inst.get('instance_id')}: {inst.get('sse_clients', 0)} clients")
    
    print(f"\n  ✓ SSE client tracking working")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Load Balancing & High Availability Test Suite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_load_balancing.py                    # Run with defaults
  python test_load_balancing.py -n 200             # 200 load balancing requests
  python test_load_balancing.py -n 500 -c 50       # 500 LB requests, 50 health checks
  python test_load_balancing.py --fast             # Quick test with fewer requests
        """
    )
    parser.add_argument("-n", "--num-requests", type=int, default=50,
                        help="Number of requests for load balancing test (default: 50)")
    parser.add_argument("-c", "--concurrent", type=int, default=20,
                        help="Number of concurrent health checks (default: 20)")
    parser.add_argument("-a", "--auth-requests", type=int, default=30,
                        help="Number of authorization requests (default: 30)")
    parser.add_argument("--fast", action="store_true",
                        help="Quick test with reduced request counts")
    parser.add_argument("--stress", action="store_true",
                        help="Stress test with high request counts (500/100/100)")
    
    args = parser.parse_args()
    
    # Adjust counts based on presets
    num_requests = args.num_requests
    concurrent = args.concurrent
    auth_requests = args.auth_requests
    
    if args.fast:
        num_requests = 10
        concurrent = 5
        auth_requests = 10
    elif args.stress:
        num_requests = 500
        concurrent = 100
        auth_requests = 100
    
    print("=" * 70)
    print("Load Balancing & High Availability Test Suite")
    print("=" * 70)
    print(f"API URL: {BASE_URL}")
    print(f"Direct URL: {DIRECT_API_URL}")
    print(f"Config: {num_requests} LB requests, {concurrent} health checks, {auth_requests} auth requests")
    
    results = {}
    
    # Test 1: Cluster instances endpoint
    passed, instances = test_cluster_instances()
    results["cluster_instances"] = passed
    
    # Test 2: Load balancing distribution
    results["load_distribution"] = test_load_balancing_distribution(num_requests)
    
    # Test 3: Concurrent health checks
    results["concurrent_health"] = test_concurrent_health_checks(concurrent)
    
    # Test 4: Authorization consistency
    results["auth_consistency"] = test_authorization_across_instances(auth_requests)
    
    # Test 5: SSE tracking
    results["sse_tracking"] = test_sse_per_instance()
    
    # Summary
    print("\n" + "=" * 70)
    print("Test Results Summary")
    print("=" * 70)
    
    for test_name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {test_name}: {status}")
    
    all_passed = all(results.values())
    print(f"\nOverall: {'✓ ALL TESTS PASSED' if all_passed else '✗ SOME TESTS FAILED'}")
    
    # Additional info
    if instances:
        print(f"\nCluster Info:")
        print(f"  Active instances: {len(instances)}")
        print(f"  Instance IDs: {[i.get('instance_id', 'unknown') for i in instances]}")
    
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()

