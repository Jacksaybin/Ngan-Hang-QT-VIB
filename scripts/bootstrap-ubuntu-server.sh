#!/usr/bin/env bash
set -euo pipefail

# bootstrap-ubuntu-server.sh
# Mô tả: Cập nhật hệ thống, tạo user không phải root, cấu hình SSH (key-based), cài Node.js + PM2, UFW, Fail2Ban
# Chạy trên Ubuntu 20.04 như root (hoặc sudo).
# Usage: sudo bash bootstrap-ubuntu-server.sh <deploy_user> <git_repo_url|skip> <app_dir|/var/www/app>

if [ "$EUID" -ne 0 ]; then
  echo "Vui lòng chạy script này với quyền root: sudo bash $0 ..." >&2
  exit 2
fi

DEPLOY_USER=${1:-deploy}
GIT_REPO=${2:-skip}
APP_DIR=${3:-/var/www/app}

echo "Bootstrap server: tạo user='$DEPLOY_USER', repo='$GIT_REPO', app_dir='$APP_DIR'"

# 1) Cập nhật hệ thống
apt update && apt upgrade -y
apt install -y curl wget git build-essential ca-certificates gnupg lsb-release software-properties-common

# 2) Tạo user không phải root (nếu chưa có)
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "User $DEPLOY_USER đã tồn tại, bỏ qua tạo mới"
else
  echo "Tạo user $DEPLOY_USER và thêm vào group sudo"
  adduser --gecos "" --disabled-password "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  echo "Bạn cần đặt public SSH key của bạn vào /home/$DEPLOY_USER/.ssh/authorized_keys"
fi

# 3) Cấu trúc thư mục SSH cho user
SSH_DIR="/home/$DEPLOY_USER/.ssh"
mkdir -p "$SSH_DIR"
chown $DEPLOY_USER:$DEPLOY_USER "$SSH_DIR"
chmod 700 "$SSH_DIR"
if [ ! -f "$SSH_DIR/authorized_keys" ]; then
  touch "$SSH_DIR/authorized_keys"
  chown $DEPLOY_USER:$DEPLOY_USER "$SSH_DIR/authorized_keys"
  chmod 600 "$SSH_DIR/authorized_keys"
  echo "Tệp authorized_keys đã tạo rỗng: hãy thêm public key của bạn vào $SSH_DIR/authorized_keys (ví dụ bằng ssh-copy-id)"
fi

# 4) Cài UFW và cấu hình cơ bản
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
# Cho phép SSH (22), HTTP(80), HTTPS(443)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Cẩn thận: nếu bạn thay đổi port SSH, thực hiện trước khi enable
ufw --force enable

# 5) Cài Fail2Ban tối thiểu
apt install -y fail2ban
cat > /etc/fail2ban/jail.d/defaults-debian.local <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 3600
EOF
systemctl restart fail2ban

# 6) Cài Node.js (NodeSource 18.x LTS) và pm2
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
npm install -g pm2

# 7) Triển khai ứng dụng (nếu có repo)
is_host_reachable() {
  local url="$1"
  local host scheme

  if [[ "$url" =~ ^git@([^:]+): ]]; then
    host="${BASH_REMATCH[1]}"
    scheme=ssh
  elif [[ "$url" =~ ^https?://([^/]+) ]]; then
    host="${BASH_REMATCH[1]}"
    scheme=https
  else
    echo "[WARN] Không thể phân tích host từ URL: $url" >&2
    return 1
  fi

  # DNS check (getent or host)
  if command -v getent >/dev/null 2>&1; then
    if ! getent hosts "$host" >/dev/null 2>&1; then
      echo "[WARN] DNS lookup failed cho host: $host" >&2
      return 1
    fi
  elif command -v host >/dev/null 2>&1; then
    if ! host "$host" >/dev/null 2>&1; then
      echo "[WARN] DNS lookup failed cho host: $host" >&2
      return 1
    fi
  fi

  # Port check (nc optional)
  local port=443
  if [ "$scheme" = "ssh" ]; then
    port=22
  fi
  if command -v nc >/dev/null 2>&1; then
    if ! nc -z -w5 "$host" "$port" >/dev/null 2>&1; then
      echo "[WARN] Không thể kết nối tới $host:$port" >&2
      return 1
    fi
  fi
  return 0
}

if [ "$GIT_REPO" != "skip" ]; then
  mkdir -p "$APP_DIR"
  chown $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"

  if ! is_host_reachable "$GIT_REPO"; then
    echo "[INFO] Host cho repo '$GIT_REPO' không thể truy cập hoặc không tồn tại. Bỏ qua bước clone."
    echo "Bạn có thể clone thủ công khi SSH tới server như user '$DEPLOY_USER':"
    echo "  sudo -u $DEPLOY_USER -i git clone $GIT_REPO $APP_DIR"
  else
    if [ -d "$APP_DIR/.git" ]; then
      echo "Đã có repository trong $APP_DIR, sẽ pull"
      sudo -u $DEPLOY_USER git -C "$APP_DIR" pull
    else
      echo "Clone repo $GIT_REPO -> $APP_DIR"
      sudo -u $DEPLOY_USER git clone "$GIT_REPO" "$APP_DIR"
    fi

    # Cài dependencies
    sudo -u $DEPLOY_USER bash -lc "cd $APP_DIR && npm install --production"

    # Chạy PM2 (user deploy)
    echo "Khởi chạy ứng dụng bằng PM2 (user: $DEPLOY_USER)"
    sudo -u $DEPLOY_USER bash -lc "cd $APP_DIR && (pm2 start ecosystem.config.js --env production || pm2 start server.js --name vib-server)"
    sudo -u $DEPLOY_USER pm2 save
    # Generate systemd startup script for this user
    sudo -u $DEPLOY_USER pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER || true
    echo "Lưu ý: Nếu lệnh pm2 startup in một lệnh systemctl, hãy chạy lệnh đó (thường cần quyền root)."
  fi
fi

# 8) Thiết lập pm2-logrotate (nếu pm2 có module)
if command -v pm2 >/dev/null 2>&1; then
  pm2 set pm2-logrotate:max_size 10M || true
  pm2 set pm2-logrotate:retain 5 || true
  pm2 set pm2-logrotate:compress false || true
fi

# 9) Cleanup
apt autoremove -y

cat <<EOF

Bootstrap hoàn tất.
Việc tiếp theo bạn cần làm (bước tay):
- Thêm public SSH key của bạn vào /home/$DEPLOY_USER/.ssh/authorized_keys (nếu chưa có)
  ví dụ từ máy local: ssh-copy-id -i ~/.ssh/id_rsa.pub root@<IP> hoặc scp
- Nếu bạn đã dùng pm2 startup, thực thi lệnh systemctl start/nginx/pm2 nếu script in yêu cầu
- Kiểm tra dịch vụ:
    sudo -u $DEPLOY_USER pm2 ls
    curl -sS http://127.0.0.1:4000/health -w "\nHTTP_STATUS:%{http_code}\n"

EOF
