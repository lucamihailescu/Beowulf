#!/bin/sh
# entrypoint.sh - Custom entrypoint for Cedar load balancer
# Starts both Nginx and the backend discovery service.

set -e

echo "[$(date)] Cedar Load Balancer starting..."

# Ensure conf.d directory exists
mkdir -p /etc/nginx/conf.d

# Create initial upstream configs so Nginx can start
echo "# Waiting for backends..." > /etc/nginx/conf.d/backend_upstreams.conf
echo "server 127.0.0.1:1 down;" >> /etc/nginx/conf.d/backend_upstreams.conf

echo "# Waiting for backends..." > /etc/nginx/conf.d/grpc_upstreams.conf
echo "server 127.0.0.1:1 down;" >> /etc/nginx/conf.d/grpc_upstreams.conf

# Start the backend discovery service in the background
echo "[$(date)] Starting backend discovery service..."
/usr/local/bin/update_backends.sh &
DISCOVERY_PID=$!

# Handle shutdown gracefully
shutdown() {
    echo "[$(date)] Shutting down..."
    kill $DISCOVERY_PID 2>/dev/null || true
    nginx -s quit
    exit 0
}

trap shutdown SIGTERM SIGINT SIGQUIT

# Start Nginx in the foreground
echo "[$(date)] Starting Nginx..."
exec nginx -g 'daemon off;'

