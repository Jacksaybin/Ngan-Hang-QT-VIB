#!/usr/bin/env bash
set -euo pipefail

# deploy-app-ubuntu.sh
# Usage (on VPS): sudo bash deploy-app-ubuntu.sh <git_repo_url> <app_dir> [deploy_user]

GIT_REPO=${1:-}
APP_DIR=${2:-/var/www/app}
DEPLOY_USER=${3:-deploy}

if [ -z "$GIT_REPO" ]; then
  echo "Usage: $0 <git_repo_url> <app_dir> [deploy_user]" >&2
  exit 2
fi

echo "Deploy: repo=$GIT_REPO dir=$APP_DIR user=$DEPLOY_USER"

mkdir -p "$APP_DIR"
chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR" || true

if [ -d "$APP_DIR/.git" ]; then
  echo "Existing git repo found in $APP_DIR, pulling latest"
  sudo -u "$DEPLOY_USER" git -C "$APP_DIR" pull --ff-only || sudo -u "$DEPLOY_USER" git -C "$APP_DIR" reset --hard origin/HEAD
else
  echo "Cloning $GIT_REPO -> $APP_DIR"
  sudo -u "$DEPLOY_USER" git clone "$GIT_REPO" "$APP_DIR"
fi

echo "Installing npm dependencies (production)"
sudo -u "$DEPLOY_USER" bash -lc "cd $APP_DIR && npm install --production --no-audit --progress=false"

echo "Starting with PM2"
sudo -u "$DEPLOY_USER" bash -lc "cd $APP_DIR && pm2 start ecosystem.config.js --env production || pm2 start server.js --name vib-server"
sudo -u "$DEPLOY_USER" pm2 save || true

echo "Ensuring pm2 startup (systemd) for user $DEPLOY_USER"
sudo -u "$DEPLOY_USER" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" || true

echo "Deployment finished. Check: sudo -u $DEPLOY_USER pm2 ls"
