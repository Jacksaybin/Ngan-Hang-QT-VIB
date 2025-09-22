#!/usr/bin/env node
// scripts/rotate-telegram-token.js
// Usage: node scripts/rotate-telegram-token.js --token <NEW_TOKEN> [--set] [--test] [--chatId <CHAT_ID>]
// - --token (required): new bot token (format digits:alphanumeric)
// - --set: actually persist the new token to .telegram-config.json
// - --test: run a safe test (calls /api/telegram/diagnose and /api/telegram/test) after setting
// - --chatId: optional chatId to set alongside token

const fs = require('fs');
const path = require('path');
const fetch =
  global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

function usage() {
  console.log(
    'Usage: node scripts/rotate-telegram-token.js --token <NEW_TOKEN> [--set] [--test] [--chatId <CHAT_ID>]'
  );
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token') opts.token = argv[++i];
    else if (a === '--set') opts.set = true;
    else if (a === '--test') opts.test = true;
    else if (a === '--chatId') opts.chatId = argv[++i];
    else {
      console.error('Unknown arg', a);
      usage();
    }
  }
  if (!opts.token) usage();
  const tok = String(opts.token).trim();
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(tok)) {
    console.error('Token format looks invalid. Expected format: <digits>:<alphanumeric>');
    process.exit(2);
  }

  const configFile = path.join(__dirname, '..', '.telegram-config.json');
  const backupFile = configFile + '.bak.' + Date.now();

  // Try getMe to validate token
  console.log('Validating token with getMe...');
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`);
    const jd = await r.json().catch(() => null);
    if (!r.ok || !jd || !jd.ok) {
      console.error('getMe failed. Response:', r.status, jd);
      console.error('Do not persist the token. Fix the token and try again.');
      process.exit(3);
    }
    console.log(
      'getMe OK. Bot info:',
      jd.result.username ? `@${jd.result.username}` : JSON.stringify(jd.result)
    );
  } catch (e) {
    console.error('Network error when calling getMe:', e.message);
    process.exit(4);
  }

  if (!opts.set) {
    console.log('\nToken validated. To persist it run again with --set');
    console.log(
      'Example: node scripts/rotate-telegram-token.js --token',
      tok,
      '--set --chatId <CHAT_ID> --test'
    );
    process.exit(0);
  }

  // Persist: backup existing config then write new
  try {
    if (fs.existsSync(configFile)) fs.copyFileSync(configFile, backupFile);
    const cur = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    const toSave = Object.assign({}, cur, { token: tok });
    if (opts.chatId) toSave.chatId = String(opts.chatId);
    // keep allowRawSensitive and receiveOnly if present in existing config
    fs.writeFileSync(configFile, JSON.stringify(toSave, null, 2), 'utf8');
    console.log('Persisted new token to', configFile, ' (backup at', backupFile, ')');
  } catch (e) {
    console.error('Failed to persist config:', e.message);
    process.exit(5);
  }

  if (opts.test) {
    // Call local server diagnose and test endpoints if server is running
    try {
      console.log('Running local /api/telegram/diagnose...');
      const diag = await fetch('http://127.0.0.1:4000/api/telegram/diagnose');
      const jd = await diag.json().catch(() => null);
      console.log('Diagnose response:', diag.status, jd);
    } catch (e) {
      console.error('Failed to call local diagnose endpoint:', e.message);
      console.log('Make sure the local server is running at http://127.0.0.1:4000');
    }
    try {
      console.log('Running local /api/telegram/test (safe)...');
      const t = await fetch('http://127.0.0.1:4000/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Rotation test message' }),
      });
      const jd2 = await t.json().catch(() => null);
      console.log('/api/telegram/test response:', t.status, jd2);
    } catch (e) {
      console.error('Failed to call local test endpoint:', e.message);
    }
  }

  console.log('Rotate complete. Review backups and logs.');
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
