#!/usr/bin/env bash
# Simple deploy script to run on the VPS (pull latest, install production deps, restart pm2)
set -e
REPO_DIR="/opt/ngan-hang-qt-vib"
if [ ! -d "$REPO_DIR" ]; then
  echo "Repo dir $REPO_DIR not found"
  exit 1
fi
cd "$REPO_DIR"
# Ensure we are on main and reset
git fetch --all
git reset --hard origin/main
# Install production dependencies
npm ci --omit=dev
# Restart app via pm2
if pm2 describe ecosystem.config.js >/dev/null 2>&1; then
  pm2 restart ecosystem.config.js --env production || true
else
  pm2 start ecosystem.config.js --env production || true
fi
pm2 save

echo "Deployed successfully"
