#!/usr/bin/env bash
set -euo pipefail
# bootstrap-vps.sh
# Idempotent helper to prepare an Ubuntu VPS for this app, install Docker, clone repo (optional),
# copy env.example -> .env.production (placeholder), and run docker compose.
# USAGE (on VPS):
#   sudo bash deploy/bootstrap-vps.sh [GIT_CLONE_URL]
# If GIT_CLONE_URL is provided, repo is cloned to /home/deploy/vib-app. Otherwise the script
# assumes the repo is already present at /home/deploy/vib-app.

REPO_DIR=/home/deploy/vib-app
GIT_URL=${1:-}

echo "==> Bootstrap VPS for vib app"

echo "[1/6] Installing prerequisites"
apt update
apt install -y ca-certificates curl gnupg lsb-release

echo "[2/6] Installing Docker (official repo, idempotent)"
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod 644 /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "[3/6] Ensure deploy user exists and is in docker group"
id -u deploy &>/dev/null || useradd -m -s /bin/bash deploy
usermod -aG docker deploy || true

echo "[4/6] Clone or prepare repository"
if [ -n "$GIT_URL" ]; then
  if [ -d "$REPO_DIR/.git" ]; then
    echo "Repository already cloned in $REPO_DIR; doing git pull"
    sudo -u deploy -H bash -c "cd $REPO_DIR && git pull --rebase"
  else
    echo "Cloning $GIT_URL -> $REPO_DIR"
    sudo -u deploy -H git clone "$GIT_URL" "$REPO_DIR"
  fi
else
  if [ ! -d "$REPO_DIR" ]; then
    echo "No GIT URL provided and $REPO_DIR does not exist. Please clone the repo to $REPO_DIR or run with GIT URL." >&2
    exit 1
  fi
fi

echo "[5/6] Copy env.example -> .env.production (if missing)"
if [ -f "$REPO_DIR/env.example" ]; then
  if [ ! -f "$REPO_DIR/.env.production" ]; then
    cp "$REPO_DIR/env.example" "$REPO_DIR/.env.production"
    echo "Created .env.production from env.example. EDIT $REPO_DIR/.env.production and set BOT_TOKEN, CHAT_ID, HMAC_KEY, REQUIRE_HMAC, PORT, NODE_ENV=production"
  else
    echo ".env.production already exists; not overwriting."
  fi
else
  echo "Warning: env.example not found in $REPO_DIR; create .env.production manually." >&2
fi

echo "[6/6] Start docker compose production stack"
cd "$REPO_DIR"
if [ -f docker-compose.prod.yml ]; then
  sudo -u deploy -H bash -c "docker compose -f docker-compose.prod.yml pull || true"
  sudo -u deploy -H bash -c "docker compose -f docker-compose.prod.yml up -d --build"
  echo "Docker compose started. Use: sudo -u deploy -H docker compose -f docker-compose.prod.yml logs -f"
else
  echo "docker-compose.prod.yml not found in $REPO_DIR. Inspect repository layout." >&2
fi

echo "Bootstrap complete. Review $REPO_DIR/.env.production, then check containers and logs."
