// Cloudflare Worker: Telegram Relay + Form Submit + OTP Flow
// SECURITY: Do NOT hard-code secrets. Use Wrangler secrets for BOT_TOKEN, CHAT_ID, HMAC_KEY.
// KV bindings: APP_KV (for otp codes, nonces, simple rate counters)
// Optional env flags:
//   REQUIRE_HMAC=1 (enforces HMAC signature verification)
//   DEBUG_RETURN_OTP=1 (returns OTP in response for dev ONLY)
//   DEMO_STATIC_OTP=1 (always generate 123456)
//   DEV_ALLOW_ENVINFO=1 (enable /_envinfo)

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            if (request.method === 'OPTIONS') return cors();

            // Basic routing
            if (url.pathname === '/_envinfo' && env.DEV_ALLOW_ENVINFO) {
                return json({ ok: true, hmac: !!env.REQUIRE_HMAC, demoOtp: !!env.DEMO_STATIC_OTP });
            }

            if (url.pathname === '/tele/sendMessage' && request.method === 'POST') {
                return withSecurity(request, env, () => handleSendMessage(request, env));
            }
            if (url.pathname === '/tele/sendDocument' && request.method === 'POST') {
                return withSecurity(request, env, () => handleSendDocument(request, env));
            }
            if (url.pathname === '/form/submit-init' && request.method === 'POST') {
                return withSecurity(request, env, () => handleSubmitInit(request, env));
            }
            if (url.pathname === '/otp/request' && request.method === 'POST') {
                return withSecurity(request, env, () => handleOtpRequest(request, env));
            }
            if (url.pathname === '/otp/verify' && request.method === 'POST') {
                return withSecurity(request, env, () => handleOtpVerify(request, env));
            }

            return new Response('Not found', { status: 404, headers: baseCorsHeaders() });
        } catch (err) {
            return json({ error: 'internal_error', message: err.message }, 500);
        }
    }
};

// ========== Utilities ==========
function baseCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Signature,X-Timestamp,X-Nonce,X-Client-Id'
    };
}
function cors() { return new Response(null, { headers: baseCorsHeaders() }); }
function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...baseCorsHeaders(), ...extra } });
}
async function readJSON(req) {
    try { return await req.json(); } catch { return null; }
}
function nowSec() { return Math.floor(Date.now() / 1000); }
function randomId(prefix = 'REQ') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

// Telegram send helpers
async function tgSend(env, method, body, isFormData = false) {
    if (!env.BOT_TOKEN || !env.CHAT_ID) throw new Error('Missing BOT_TOKEN or CHAT_ID');
    const api = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
    const init = isFormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(api, init);
    if (!res.ok) {
        const text = await res.text();
        return { ok: false, status: res.status, raw: text };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
}
function sanitizeMessage(text = '') {
    // Remove control chars & clamp length
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 3800);
}

// ========== Security (HMAC + Nonce + Rate) ==========
async function withSecurity(request, env, handler) {
    // Basic per-IP rate gate (quick approximation)
    const ip = request.headers.get('CF-Connecting-IP') || 'ip-unknown';
    const okRate = await simpleRateLimit(env, `ip:${ip}`, 300, 60); // 300 req / 60s
    if (!okRate) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '20' });

    if (env.REQUIRE_HMAC) {
        const valid = await verifyHmac(request, env);
        if (!valid.ok) return json({ error: valid.error || 'unauthorized' }, 401);
    }
    return handler();
}

async function verifyHmac(request, env) {
    const sigHeader = request.headers.get('X-Signature');
    const tsHeader = request.headers.get('X-Timestamp');
    const nonce = request.headers.get('X-Nonce');
    if (!sigHeader || !tsHeader || !nonce) return { ok: false, error: 'missing_headers' };
    const ts = parseInt(tsHeader, 10);
    if (!ts || Math.abs(nowSec() - ts) > 120) return { ok: false, error: 'timestamp_out_of_range' };
    // Nonce replay check
    const nonceKey = `nonce:${nonce}`;
    const seen = await env.APP_KV.get(nonceKey);
    if (seen) return { ok: false, error: 'nonce_replay' };
    await env.APP_KV.put(nonceKey, '1', { expirationTtl: 300 });

    const bodyText = await request.clone().text();
    const method = request.method.toUpperCase();
    const path = new URL(request.url).pathname;
    const baseString = `${method}\n${path}\n${ts}\n${nonce}\n${bodyText}`;
    const expected = await hmacHex(env.HMAC_KEY, baseString);
    const provided = sigHeader.startsWith('v1=') ? sigHeader.slice(3) : sigHeader;
    if (!timingSafeEqualHex(expected, provided)) return { ok: false, error: 'bad_signature' };
    return { ok: true };
}

async function hmacHex(secret, msg) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqualHex(a, b) {
    if (a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return res === 0;
}

async function simpleRateLimit(env, key, max, windowSec) {
    const bucketKey = `rate:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const current = await env.APP_KV.get(bucketKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= max) return false;
    await env.APP_KV.put(bucketKey, (count + 1).toString(), { expirationTtl: windowSec + 5 });
    return true;
}

// ========== OTP support ==========
function generateOtp(env) {
    if (env.DEMO_STATIC_OTP) return '123456';
    return Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
}
async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function storeOtp(env, requestId, phone, code, ttlSec = 60) {
    const salt = randomId('salt').slice(-8);
    const codeHash = await sha256Hex(code + '.' + salt);
    const record = {
        phone,
        salt,
        codeHash,
        expireAt: Date.now() + ttlSec * 1000,
        attempts: 0,
        maxAttempts: 6,
        createdAt: Date.now()
    };
    await env.APP_KV.put(`otp:${requestId}`, JSON.stringify(record), { expirationTtl: ttlSec + 300 });
    return { ttlSec, record };
}

async function getOtpRecord(env, requestId) {
    const raw = await env.APP_KV.get(`otp:${requestId}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}
async function saveOtpRecord(env, requestId, rec) {
    // Keep remaining TTL based on expireAt; ensure at least some TTL.
    const ttl = Math.max(Math.floor((rec.expireAt - Date.now()) / 1000), 30);
    await env.APP_KV.put(`otp:${requestId}`, JSON.stringify(rec), { expirationTtl: ttl });
}

// ========== Handlers ==========
async function handleSendMessage(request, env) {
    const body = await readJSON(request);
    if (!body || typeof body.message !== 'string') return json({ error: 'invalid_body' }, 400);
    const text = sanitizeMessage(body.message);
    const res = await tgSend(env, 'sendMessage', { chat_id: env.CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    if (!res.ok) return json({ error: 'telegram_error', detail: res.raw }, res.status || 500);
    return json({ status: 'ok', messageId: res.data?.result?.message_id });
}

async function handleSendDocument(request, env) {
    const form = await request.formData();
    const file = form.get('file') || form.get('document');
    if (!file) return json({ error: 'missing_file' }, 400);
    const fd = new FormData();
    fd.append('chat_id', env.CHAT_ID);
    fd.append('document', file, file.name || 'file');
    if (form.get('caption')) fd.append('caption', sanitizeMessage(form.get('caption')));
    const res = await tgSend(env, 'sendDocument', fd, true);
    if (!res.ok) return json({ error: 'telegram_error', detail: res.raw }, res.status || 500);
    return json({ status: 'ok' });
}

async function handleSubmitInit(request, env) {
    const body = await readJSON(request);
    if (!body || typeof body.summary !== 'string' || !body.summary.trim()) return json({ error: 'invalid_summary' }, 400);
    const phone = body.phone || '';
    const requestId = randomId('REQ');
    // store OTP
    const code = generateOtp(env);
    await storeOtp(env, requestId, phone, code, 60);
    // Optionally send a Telegram pre-log (audit)
    await safeAudit(env, `INIT ${requestId}\nPhone: ${maskPhone(phone)}\nLen(summary): ${body.summary.length}`);
    return json({ status: 'ok', requestId, maskedPhone: maskPhone(phone), otp: { ttlSeconds: 60, length: 6, resendAfter: 30 }, debugOtp: env.DEBUG_RETURN_OTP ? code : undefined });
}

async function handleOtpRequest(request, env) {
    const body = await readJSON(request);
    if (!body || !body.requestId) return json({ error: 'missing_requestId' }, 400);
    const rec = await getOtpRecord(env, body.requestId);
    if (!rec) return json({ error: 'not_found' }, 404);
    // Rate limit resend per requestId (store counter)
    const allow = await simpleRateLimit(env, `otp_resend:${body.requestId}`, 3, 300);
    if (!allow) return json({ error: 'resend_rate_limited' }, 429);
    // generate new code overriding old
    const code = generateOtp(env);
    await storeOtp(env, body.requestId, rec.phone, code, 60);
    await safeAudit(env, `RESEND OTP ${body.requestId}`);
    return json({ status: 'ok', otp: { ttlSeconds: 60, resendAfter: 30 }, debugOtp: env.DEBUG_RETURN_OTP ? code : undefined });
}

async function handleOtpVerify(request, env) {
    const body = await readJSON(request);
    if (!body || !body.requestId || !body.otp) return json({ error: 'missing_fields' }, 400);
    const rec = await getOtpRecord(env, body.requestId);
    if (!rec) return json({ error: 'otp_not_found' }, 404);
    if (Date.now() > rec.expireAt) return json({ error: 'otp_expired' }, 400);
    if (rec.attempts >= rec.maxAttempts) return json({ error: 'otp_locked' }, 400);
    const codeHash = await sha256Hex(body.otp + '.' + rec.salt);
    const match = codeHash === rec.codeHash;
    rec.attempts += 1;
    await saveOtpRecord(env, body.requestId, rec);
    if (!match) {
        await safeAudit(env, `OTP WRONG ${body.requestId} attempt:${rec.attempts}`);
        if (rec.attempts >= rec.maxAttempts) return json({ status: 'error', code: 'OTP_LOCKED' }, 400);
        return json({ status: 'error', code: 'OTP_INVALID', remaining: rec.maxAttempts - rec.attempts }, 400);
    }
    // success
    await env.APP_KV.delete(`otp:${body.requestId}`);
    await safeAudit(env, `OTP OK ${body.requestId}`);
    // Relay final summary if provided inline optional (or client can have done earlier). For minimal design we accept summary param optional.
    if (body.summary && body.summary.length < 10000) {
        const text = sanitizeMessage(body.summary + `\n\n(rid:${body.requestId})`);
        await tgSend(env, 'sendMessage', { chat_id: env.CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    return json({ status: 'verified', submittedAt: new Date().toISOString() });
}

async function safeAudit(env, text) {
    try { await tgSend(env, 'sendMessage', { chat_id: env.CHAT_ID, text: sanitizeMessage(`_AUDIT:_ ${text}`), parse_mode: 'Markdown' }); } catch { }
}

function maskPhone(p) {
    if (!p) return '—';
    return p.replace(/^(\+?84|0)?(\d{3})\d+(\d{2})$/, '$1$2***$3');
}
