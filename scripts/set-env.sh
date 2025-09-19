#!/usr/bin/env bash
set -euo pipefail
ENV_FILE=.env
touch "$ENV_FILE"

read -p "API_URL (leave empty to keep current): " API_URL
read -p "API_KEY (leave empty to keep current): " API_KEY
read -p "TELEGRAM_BOT_TOKEN (leave empty to keep current): " TELEGRAM_BOT_TOKEN
read -p "TELEGRAM_CHAT_ID (leave empty to keep current): " TELEGRAM_CHAT_ID

set_or_update() {
  key=$1; val=$2
  if [[ -z "$val" ]]; then return; fi
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i -E "s|^$key=.*|$key=$val|g" "$ENV_FILE"
  else
    echo "$key=$val" >> "$ENV_FILE"
  fi
}

set_or_update "API_URL" "$API_URL"
set_or_update "API_KEY" "$API_KEY"
set_or_update "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN"
set_or_update "TELEGRAM_CHAT_ID" "$TELEGRAM_CHAT_ID"

echo "Updated $ENV_FILE"
read -p "Send test Telegram message now? (y/N): " run
if [[ "$run" =~ ^[Yy]$ ]]; then
  node scripts/test-telegram.js
fi
