# Dockerfile for Cedar Load Balancer
# This extends the official Nginx image with dynamic backend discovery.

FROM nginx:1.27-alpine

# Install curl for backend discovery
RUN apk add --no-cache curl

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy discovery scripts
COPY update_backends.sh /usr/local/bin/update_backends.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/update_backends.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

# Create conf.d directory for dynamic configs
RUN mkdir -p /etc/nginx/conf.d

# Expose ports
EXPOSE 80 8080 50051

# Use custom entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

