#!/usr/bin/env bash
set -euo pipefail

# auto-deploy.sh
# Usage: sudo bash auto-deploy.sh [deploy_user] [repo_url] [app_dir]
# Examples:
#   sudo bash auto-deploy.sh deploy git@nganhangquoctevib.com:group/project.git /var/www/app
#   sudo bash auto-deploy.sh deploy skip /var/www/app   # to only prepare server and print SSH pubkey

DEPLOY_USER=${1:-deploy}
REPO_URL=${2:-}
APP_DIR=${3:-/var/www/app}
BOOTSTRAP_PATH=/root/bootstrap-ubuntu-server.sh

if [ "$EUID" -ne 0 ]; then
  echo "Vui lòng chạy script này với quyền root: sudo bash $0 ..." >&2
  exit 2
fi

echo "Auto-deploy: deploy_user=$DEPLOY_USER repo_url=${REPO_URL:-<none>} app_dir=$APP_DIR"

# Run bootstrap (skip clone) if available
if [ -x "$BOOTSTRAP_PATH" ]; then
  echo "Running bootstrap (skip clone) via $BOOTSTRAP_PATH"
  "$BOOTSTRAP_PATH" "$DEPLOY_USER" skip "$APP_DIR"
else
  echo "Bootstrap script not found at $BOOTSTRAP_PATH — skipping system bootstrap step"
fi

# Ensure deploy user exists
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "User $DEPLOY_USER exists"
else
  echo "Creating user $DEPLOY_USER"
  adduser --gecos "" --disabled-password "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER" || true
fi

# Ensure .ssh dir and key for deploy
SSH_DIR="/home/$DEPLOY_USER/.ssh"
mkdir -p "$SSH_DIR"
chown $DEPLOY_USER:$DEPLOY_USER "$SSH_DIR"
chmod 700 "$SSH_DIR"

KEY_FILE="$SSH_DIR/id_ed25519"
if [ ! -f "$KEY_FILE" ]; then
  echo "Generating SSH key for $DEPLOY_USER"
  sudo -u $DEPLOY_USER ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -q
  chmod 600 "$KEY_FILE"
fi

echo
echo "Public key for $DEPLOY_USER (add this to your Git host Deploy keys / SSH keys):"
sudo -u $DEPLOY_USER cat "$KEY_FILE.pub"
echo

if [ -z "$REPO_URL" ] || [ "$REPO_URL" = "skip" ]; then
  echo "No repo URL provided or 'skip' selected — prepared server and printed public key above."
  echo "After adding the public key to your Git host, run on server as root to clone & start:" \
       "sudo -u $DEPLOY_USER -i git clone git@<HOST>:<group>/<repo>.git $APP_DIR && sudo -u $DEPLOY_USER -i bash -lc 'cd $APP_DIR && npm install --production && (pm2 start ecosystem.config.js --env production || pm2 start server.js --name vib-server) && pm2 save'"
  exit 0
fi

echo "Repo URL provided: $REPO_URL"

# Detect SSH vs HTTPS
if [[ "$REPO_URL" =~ ^git@([^:]+): ]]; then
  REPO_HOST="${BASH_REMATCH[1]}"
  echo "Detected SSH repo host: $REPO_HOST"

  # Resolve host IPs and warn if they look like Cloudflare (best-effort)
  HOST_IPS=$(getent ahosts "$REPO_HOST" 2>/dev/null | awk '{print $1}' | sort -u || true)
  echo "Resolved IPs for $REPO_HOST: ${HOST_IPS:-<none>}"

  # Add host key(s) to known_hosts for deploy user
  echo "Adding host keys to $SSH_DIR/known_hosts"
  for ip in $HOST_IPS; do
    sudo -u $DEPLOY_USER ssh-keyscan -H "$ip" >> "$SSH_DIR/known_hosts" 2>/dev/null || true
  done
  sudo -u $DEPLOY_USER ssh-keyscan -H "$REPO_HOST" >> "$SSH_DIR/known_hosts" 2>/dev/null || true
  chown $DEPLOY_USER:$DEPLOY_USER "$SSH_DIR/known_hosts" || true
  chmod 644 "$SSH_DIR/known_hosts" || true

  echo "Attempting to clone via SSH as $DEPLOY_USER..."
  if sudo -u $DEPLOY_USER git clone "$REPO_URL" "$APP_DIR"; then
    echo "Clone successful"
  else
    echo "Clone failed. Common reasons: public key not added to Git host, or DNS is proxied by Cloudflare (SSH won't reach origin)."
    echo "Public key (again):" ; sudo -u $DEPLOY_USER cat "$KEY_FILE.pub"
    exit 1
  fi
else
  echo "Detected HTTPS repo URL. Attempting HTTPS clone as $DEPLOY_USER"
  if sudo -u $DEPLOY_USER git clone "$REPO_URL" "$APP_DIR"; then
    echo "HTTPS clone successful"
  else
    echo "HTTPS clone failed. If the repo is private, use SSH deploy key or provide credentials."
    exit 1
  fi
fi

# Post-clone: install and start
echo "Installing dependencies and starting app with pm2"
sudo -u $DEPLOY_USER bash -lc "cd $APP_DIR && npm install --production"
sudo -u $DEPLOY_USER bash -lc "cd $APP_DIR && (pm2 start ecosystem.config.js --env production || pm2 start server.js --name vib-server) || true"
sudo -u $DEPLOY_USER pm2 save || true
sudo -u $DEPLOY_USER pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER || true

echo
echo "Auto-deploy finished. Verify with:" 
echo "  sudo -u $DEPLOY_USER pm2 ls"
echo "  curl -sS http://127.0.0.1:4000/health -w '\nHTTP_STATUS:%{http_code}\n'"

echo "If pm2 startup printed a systemctl command, run that command as root to enable pm2 on boot."
