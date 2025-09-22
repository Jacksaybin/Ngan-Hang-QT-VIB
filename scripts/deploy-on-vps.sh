#!/usr/bin/env bash
set -euo pipefail

# deploy-on-vps.sh
# Usage (as root):
#   bash /tmp/deploy-on-vps.sh /tmp/deploy-preview.zip
# If no argument provided, defaults to /tmp/deploy-preview.zip

ARCHIVE=${1:-/tmp/deploy-preview.zip}
DEPLOY_USER=deploy
APP_DIR="/home/${DEPLOY_USER}/vib"
TIMESTAMP=$(date +%Y%m%d%H%M%S)

echo "Starting automated deploy: archive=${ARCHIVE}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Use the VNC console or SSH as root."
  exit 1
fi

if [ ! -f "${ARCHIVE}" ]; then
  echo "ERROR: Archive not found: ${ARCHIVE}"
  exit 1
fi

echo "Backing up current app (if exists)..."
if [ -d "${APP_DIR}" ]; then
  mv "${APP_DIR}" "${APP_DIR}.bak.${TIMESTAMP}"
  echo "Moved existing ${APP_DIR} -> ${APP_DIR}.bak.${TIMESTAMP}"
fi

echo "Ensuring system packages (unzip, curl, build-essential)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y unzip curl build-essential ca-certificates gnupg

echo "Ensure deploy user exists..."
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${DEPLOY_USER}"
  echo "Created user ${DEPLOY_USER}"
fi

mkdir -p "${APP_DIR}"
echo "Extracting archive to ${APP_DIR}..."
unzip -o "${ARCHIVE}" -d "${APP_DIR}"
chown -R "${DEPLOY_USER}":"${DEPLOY_USER}" "${APP_DIR}"

echo "Installing Node.js 18 and pm2 (if not present)..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2@latest
fi

echo "Installing npm dependencies as ${DEPLOY_USER} (production)..."
sudo -iu "${DEPLOY_USER}" bash -lc "cd '${APP_DIR}' && npm ci --production || npm install --production"

echo "Starting / restarting app with pm2 as ${DEPLOY_USER}..."
sudo -iu "${DEPLOY_USER}" bash -lc "cd '${APP_DIR}' && pm2 startOrRestart ecosystem.config.js --env production"

echo "Configuring pm2 startup (systemd) for user ${DEPLOY_USER}..."
# Ensure PATH is preserved; run startup as root (pm2 will instruct a command if necessary)
env PATH="/usr/bin:/usr/local/bin:$PATH" pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" || true

echo "Saving pm2 process list (pm2 save) as ${DEPLOY_USER}..."
sudo -iu "${DEPLOY_USER}" pm2 save

echo "Cleaning up: removing archive ${ARCHIVE}"
rm -f "${ARCHIVE}"

echo "Deployment finished. Check PM2 status with: sudo -iu ${DEPLOY_USER} pm2 ls"
echo "Check logs: sudo -iu ${DEPLOY_USER} pm2 logs --lines 200"
echo "Important: rotate root password and revoke VNC token in provider control panel immediately after verifying the app is healthy."

exit 0
