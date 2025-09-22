Rotate Telegram token helper

This folder contains `rotate-telegram-token.js` — a safe helper to validate and optionally persist a new Telegram bot token.

Usage examples (PowerShell):

# Validate token but don't persist

node scripts/rotate-telegram-token.js --token 123456:ABCdefGhIjK

# Persist validated token and set chatId

node scripts/rotate-telegram-token.js --token 123456:ABCdefGhIjK --set --chatId -1001234567890

# Persist and run local diagnose + test (local server must be running)

node scripts/rotate-telegram-token.js --token 123456:ABCdefGhIjK --set --test

Notes:

- The script calls Telegram `getMe` to validate the token before persisting.
- When `--set` is used the script will back up existing `.telegram-config.json` to `.telegram-config.json.bak.TIMESTAMP`.
- `--test` will call `http://127.0.0.1:4000/api/telegram/diagnose` and `/api/telegram/test` if your server is running locally.
- Do NOT paste tokens into public chat. Use your terminal.
