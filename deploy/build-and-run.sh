#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./build-and-run.sh /path/to/repo <domain>
# Example: sudo ./build-and-run.sh /home/ubuntu/vib-app example.com

REPO_DIR=${1:-/home/ubuntu/vib-app}
DOMAIN=${2:-yourdomain.com}

echo "Using repo dir: $REPO_DIR"
cd "$REPO_DIR"

echo "Building images..."
docker compose -f docker-compose.prod.yml build --pull

echo "Bringing up containers..."
docker compose -f docker-compose.prod.yml up -d

echo "Reloading nginx (if exists)"
if command -v systemctl >/dev/null 2>&1; then
  systemctl reload nginx || true
fi

echo "Deployment complete. Visit http://$DOMAIN or http://<server-ip>:3000"
