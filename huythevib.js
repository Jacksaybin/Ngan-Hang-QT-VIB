/**
 * Minimal Telegram relay (ổn định cho dev).
 * ================== CÁC BIẾN MÔI TRƯỜNG (SECRETS) PHẢI THIẾT LẬP ==================
 *  BẮT BUỘC:
 *    - BOT_TOKEN            -> wrangler secret put BOT_TOKEN        (Token bot Telegram dạng 123456789:ABC...)
 *    - CHAT_ID              -> wrangler secret put CHAT_ID          (message.chat.id lấy từ getUpdates; group supergroup dạng -100...)
 *  TUỲ CHỌN & BẢO MẬT:
 *    - ORIGIN_WHITELIST     -> vd: "https://site1.com,https://app.example" (mặc định *)
 *    - RATE_LIMIT_WINDOW_SECONDS -> vd: 600 (mặc định 600)
 *    - RATE_LIMIT_MAX       -> vd: 60 (mặc định 60) (có thể đặt thấp để test: 3)
 *    - REQUIRE_HMAC         -> "1" để bật kiểm tra chữ ký HMAC
 *    - HMAC_SECRET          -> Chuỗi bí mật để tạo HMAC (bắt buộc nếu REQUIRE_HMAC=1)
 *    - DEBUG                -> "1" bật log debug (không dùng ở prod lâu dài)
 *  KV (tùy chọn):
 *    - RATE_KV binding trong wrangler.toml để rate limit ổn định hơn (qua cold start)
 *
 *  CÁC BƯỚC TỐI THIỂU:
 *    1. wrangler secret put BOT_TOKEN
 *    2. wrangler secret put CHAT_ID
 *    3. wrangler deploy
 *    4. Gửi POST /sendMessage {"text":"Hello"}
 *
 *  KIỂM TRA /_envinfo để xem:
 *    - bot_token_pattern_ok, bot_token_colon_count
 *    - chat_id_numeric, chat_id_sanitized, chat_id_looks_like_bot_id
 *
 *  GHI CHÚ BẢO MẬT:
 *    - Nếu BOT_TOKEN từng xuất hiện bên ngoài secret store: rotate qua BotFather.
 *    - Không commit token / chat id vào repo.
 * ================================================================================
 */
// Env vars:
// BOT_TOKEN, CHAT_ID (bắt buộc để gửi Telegram)
// ORIGIN_WHITELIST (chuỗi , phân tách) ví dụ: "http://localhost:5500,https://abc.com"
// RATE_LIMIT_WINDOW_SECONDS (mặc định 600 = 10 phút)
// RATE_LIMIT_MAX (mặc định 60 yêu cầu / IP / window)
// REQUIRE_HMAC = "1" để bật kiểm tra chữ ký
// HMAC_SECRET (bắt buộc nếu REQUIRE_HMAC=1)
// Bật KV (tùy chọn) cho rate limit ổn định: trong wrangler.toml thêm
// [[kv_namespaces]] binding = "RATE_KV" id = "..."
// Nếu không có KV, sẽ dùng in-memory Map (mất khi cold start)

export default {
  async fetch(request, env, ctx) {
    let { BOT_TOKEN, CHAT_ID, ORIGIN_WHITELIST, RATE_KV, REQUIRE_HMAC, HMAC_SECRET, DEBUG } = env; // <- (1) Nhận BOT_TOKEN & CHAT_ID từ môi trường (Wrangler secrets)
    // Trim để tránh lỗi dán token / chat id có khoảng trắng hoặc newline
    if (BOT_TOKEN) BOT_TOKEN = BOT_TOKEN.trim(); // <- (2) BOT_TOKEN được chuẩn hoá (trim)
    if (CHAT_ID) CHAT_ID = CHAT_ID.trim();       // <- (3) CHAT_ID được chuẩn hoá (trim)
    // Sanitize CHAT_ID nếu người dùng vô tình dán cả chuỗi dài kèm ký tự khác
    let chatIdSanitized = false;
    const originalChatId = CHAT_ID || '';
    if (CHAT_ID && !/^[-]?[0-9]+$/.test(CHAT_ID)) {
      // Thu thập tất cả chuỗi số (>=5 chữ số) để chọn ứng viên tốt nhất (tránh chọn bot id nếu có lựa chọn khác)
      const candidates = CHAT_ID.match(/-?[0-9]{5,}/g) || [];
      if (candidates.length) {
        // Nếu chỉ có một -> dùng luôn
        // Nếu nhiều: ưu tiên số âm (group id) rồi đến số khác botIdFromToken, cuối cùng fallback phần đầu tiên
        let botIdTmp = BOT_TOKEN ? BOT_TOKEN.split(':', 1)[0] : '';
        let chosen = candidates[0];
        const neg = candidates.find(c => c.startsWith('-'));
        if (neg) chosen = neg; else {
          const notBot = candidates.find(c => c !== botIdTmp);
          if (notBot) chosen = notBot;
        }
        CHAT_ID = chosen; // <- (5) CHAT_ID sau sanitize nâng cao
        chatIdSanitized = true;
      }
    }
    // Nhận diện trường hợp người dùng dùng nhầm bot id (phần số trước dấu :) làm CHAT_ID (sau sanitize ở trên)
    const botIdFromToken = BOT_TOKEN ? BOT_TOKEN.split(':', 1)[0] : ''; // <- (6) Lấy bot id (phần số trước dấu :) từ BOT_TOKEN
    const chatIdLooksLikeBotId = botIdFromToken && CHAT_ID === botIdFromToken; // <- (7) So sánh để cảnh báo

    // (8) DÙNG BOT_TOKEN tạo base URL gọi Telegram API
    const TG_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

    const url = new URL(request.url);

    // ---- CORS ----
    const origin = request.headers.get('Origin') || '';
    const allowed = (ORIGIN_WHITELIST || '*').split(',').map(s => s.trim()).filter(Boolean);
    const allowAll = allowed.includes('*');
    const okOrigin = allowAll || allowed.includes(origin);
    const corsOrigin = okOrigin ? (origin || '*') : 'null';

    function baseHeaders(extra = {}) {
      return {
        'Access-Control-Allow-Origin': corsOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        ...extra
      };
    }
    function json(obj, status = 200) {
      return new Response(JSON.stringify(obj), {
        status,
        headers: baseHeaders({ 'Content-Type': 'application/json' })
      });
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: baseHeaders() });

    // ---- Health (không cần secrets) ----
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ status: 'ok', endpoints: ['/sendMessage', '/sendDocument'] });
    }

    // ---- Env info (không trả giá trị secrets) ----
    if (url.pathname === '/_envinfo' && request.method === 'GET') {
      const rlWin = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || '600', 10);
      const rlMaxRaw = env.RATE_LIMIT_MAX;
      let rlMaxParsed = parseInt(rlMaxRaw || '60', 10);
      if (Number.isNaN(rlMaxParsed) || rlMaxParsed <= 0) rlMaxParsed = 60;
      const colonCount = BOT_TOKEN ? (BOT_TOKEN.match(/:/g) || []).length : 0; // <- (9) Phân tích BOT_TOKEN: số dấu :
      const tokenPatternOk = BOT_TOKEN ? /^[0-9]+:[A-Za-z0-9_-]{30,}$/.test(BOT_TOKEN) : false; // <- (10) Kiểm tra pattern BOT_TOKEN
      const chatIdNumeric = CHAT_ID ? /^-?[0-9]+$/.test(CHAT_ID) : false; // <- (11) Kiểm tra numeric CHAT_ID
      return json({
        has_bot_token: !!BOT_TOKEN,
        has_chat_id: !!CHAT_ID,
        bot_token_prefix: BOT_TOKEN ? BOT_TOKEN.slice(0, 10) : '', // <- (12) Chỉ hiển thị prefix BOT_TOKEN để debug an toàn
        bot_token_length: BOT_TOKEN ? BOT_TOKEN.length : 0,
        chat_id_length: CHAT_ID ? CHAT_ID.length : 0,
        bot_token_has_space: BOT_TOKEN ? /\s/.test(BOT_TOKEN) : false,
        chat_id_has_space: CHAT_ID ? /\s/.test(CHAT_ID) : false,
        bot_token_colon_count: colonCount,
        bot_token_pattern_ok: tokenPatternOk,
        chat_id_numeric: chatIdNumeric,
        chat_id_sanitized: chatIdSanitized,
        chat_id_looks_like_bot_id: chatIdLooksLikeBotId, // <- (13) Cờ cảnh báo CHẠY SAI CHAT_ID
        original_chat_id_length: originalChatId.length,
        original_chat_id_prefix: originalChatId ? originalChatId.slice(0, 8) : '',
        hmac_enabled: REQUIRE_HMAC === '1',
        rate_limit_window: rlWin,
        rate_limit_max: rlMaxParsed,
        kv_bound: !!RATE_KV
      });
    }

    // ---- Rate Limit helpers ----
    const RL_WINDOW = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || '600', 10); // giây
    const RL_MAX = parseInt(env.RATE_LIMIT_MAX || '60', 10);
    const now = Date.now();
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const windowId = Math.floor(now / (RL_WINDOW * 1000));

    if (!globalThis.__rl_mem) globalThis.__rl_mem = new Map();
    const mem = globalThis.__rl_mem;

    async function checkAndIncRate() {
      const keyBase = `${ip}:${windowId}`;
      if (RATE_KV) {
        const kvKey = `rl:${keyBase}`;
        let current = await RATE_KV.get(kvKey);
        let count = current ? parseInt(current, 10) : 0;
        if (count >= RL_MAX) return false;
        count++;
        const ttl = (RL_WINDOW * 1000) - (now - windowId * RL_WINDOW * 1000);
        await RATE_KV.put(kvKey, String(count), { expirationTtl: Math.max(Math.ceil(ttl / 1000), 1) });
        return true;
      } else {
        const memKey = keyBase;
        let entry = mem.get(memKey);
        if (!entry || entry.windowId !== windowId) {
          entry = { windowId, count: 0 };
        }
        if (entry.count >= RL_MAX) return false;
        entry.count++;
        mem.set(memKey, entry);
        if (mem.size > 5000) {
          for (const [k, v] of mem.entries()) {
            if (v.windowId !== windowId) mem.delete(k);
          }
        }
        return true;
      }
    }

    function rateLimitExceededResponse(remainingSec) {
      const body = { error: 'rate_limited', retry_after_seconds: remainingSec };
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: baseHeaders({
          'Content-Type': 'application/json',
          'Retry-After': String(remainingSec)
        })
      });
    }

    // ---- HMAC verify (optional) ----
    async function verifyHmacIfEnabled(rawBody, headers) {
      if (REQUIRE_HMAC !== '1') return true;
      if (!HMAC_SECRET) return false; // <- (14) Cần HMAC_SECRET khi bật REQUIRE_HMAC
      const sig = headers.get('x-signature');
      const ts = headers.get('x-timestamp');
      const nonce = headers.get('x-nonce');
      if (!sig || !ts || !nonce) return false;
      const tsNum = parseInt(ts, 10);
      if (!tsNum || Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) return false;
      const data = `${rawBody}.${ts}.${nonce}`; // <- (15) Chuỗi dùng để ký HMAC
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
      const expected = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      return expected === sig.toLowerCase();
    }

    // ---- /sendMessage ----
    if (url.pathname === '/sendMessage' && request.method === 'POST') {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: 'Server not configured' }, 500); // <- (16) Cần BOT_TOKEN + CHAT_ID
      if (chatIdLooksLikeBotId) {
        return json({ error: 'chat_id_looks_like_bot_id', hint: 'CHAT_ID phải là message.chat.id lấy từ getUpdates (private: user id riêng; group: âm -100...), không phải phần số đầu của BOT_TOKEN.' }, 400);
      }
      let raw = '';
      try { raw = await request.text(); } catch { }
      if (!(await verifyHmacIfEnabled(raw, request.headers))) {
        return json({ error: 'invalid_signature' }, 401);
      }
      let payload;
      try { payload = JSON.parse(raw || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const text = (payload.text || '').toString().trim();
      if (!text) return json({ error: 'text required' }, 400);

      const allowed = await checkAndIncRate();
      if (!allowed) {
        const remainingSec = Math.max(
          Math.ceil((((windowId + 1) * RL_WINDOW * 1000) - Date.now()) / 1000),
          1
        );
        return rateLimitExceededResponse(remainingSec);
      }

      try {
        const tgUrl = `${TG_API_BASE}/sendMessage`; // <- (17) Gọi Telegram với BOT_TOKEN
        const basePayload = {
          chat_id: CHAT_ID, // <- (18) Truyền CHAT_ID vào Telegram
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        };
        if (DEBUG === '1') console.log('[sendMessage] attempt#1 markdown', tgUrl, { len: text.length });
        let tgRes = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(basePayload)
        });
        let data = await tgRes.json().catch(() => ({}));
        // Fallback: nếu lỗi parse markdown (400) thì thử lại không parse_mode
        const desc = (data && data.description) ? String(data.description).toLowerCase() : '';
        const isParseErr = tgRes.status === 400 && /parse|entity/.test(desc);
        if (isParseErr) {
          if (DEBUG === '1') console.log('[sendMessage] markdown parse error, retrying without parse_mode', desc);
          const plainPayload = { chat_id: CHAT_ID, text, disable_web_page_preview: true };
          tgRes = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plainPayload)
          });
          const data2 = await tgRes.json().catch(() => ({}));
          if (DEBUG === '1') console.log('[sendMessage] attempt#2 plain status', tgRes.status, data2);
          return json(data2, tgRes.ok ? 200 : tgRes.status);
        }
        if (DEBUG === '1') {
          console.log('[sendMessage] status', tgRes.status, data);
          if (tgRes.status === 404) {
            console.log('[sendMessage] 404 debug prefix', BOT_TOKEN ? BOT_TOKEN.slice(0, 15) : 'NO_TOKEN'); // <- (19) Log prefix BOT_TOKEN để debug không lộ toàn bộ
          }
        }
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        if (DEBUG === '1') console.log('[sendMessage] exception', e);
        return json({ error: 'telegram_request_failed', detail: e.message }, 502);
      }
    }

    // ---- /sendDocument ----
    if (url.pathname === '/sendDocument' && request.method === 'POST') {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: 'Server not configured' }, 500); // <- (20) Cần BOT_TOKEN + CHAT_ID
      if (chatIdLooksLikeBotId) {
        return json({ error: 'chat_id_looks_like_bot_id', hint: 'CHAT_ID phải là message.chat.id lấy từ getUpdates (private: user id riêng; group: âm -100...), không phải phần số đầu của BOT_TOKEN.' }, 400);
      }
      let form;
      try { form = await request.formData(); } catch { return json({ error: 'Expected multipart/form-data' }, 400); }
      if (REQUIRE_HMAC === '1') {
        if (!HMAC_SECRET) return json({ error: 'invalid_signature' }, 401); // <- (21) Bật HMAC cần secret
      }
      const file = form.get('document');
      if (!(file instanceof File)) return json({ error: 'document file required' }, 400);
      if (file.size > 15 * 1024 * 1024) return json({ error: 'document too large (>15MB)' }, 413);
      const caption = (form.get('caption') || '').toString().slice(0, 1000);

      const allowed = await checkAndIncRate();
      if (!allowed) {
        const remainingSec = Math.max(
          Math.ceil((((windowId + 1) * RL_WINDOW * 1000) - Date.now()) / 1000),
          1
        );
        return rateLimitExceededResponse(remainingSec);
      }

      const fd = new FormData();
      fd.append('chat_id', CHAT_ID); // <- (22) CHAT_ID gửi lên Telegram
      fd.append('document', file, file.name || 'file');
      if (caption) fd.append('caption', caption);
      try {
        const tgUrl = `${TG_API_BASE}/sendDocument`; // <- (23) Endpoint dùng BOT_TOKEN
        if (DEBUG === '1') {
          console.log('[sendDocument] url', tgUrl);
        }
        const tgRes = await fetch(tgUrl, {
          method: 'POST',
          body: fd
        });
        const data = await tgRes.json().catch(() => ({}));
        if (DEBUG === '1') {
          console.log('[sendDocument] status', tgRes.status, data);
          if (tgRes.status === 404) {
            console.log('[sendDocument] 404 debug prefix', BOT_TOKEN ? BOT_TOKEN.slice(0, 15) : 'NO_TOKEN'); // <- (24) Debug prefix BOT_TOKEN
          }
        }
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        if (DEBUG === '1') console.log('[sendDocument] exception', e);
        return json({ error: 'telegram_request_failed', detail: e.message }, 502);
      }
    }

    return json({ error: 'Not found' }, 404);
  }
};

// Removed stray setInterval referencing snapshotAll (not defined in Worker). Snapshot logic belongs only in client.

typeof bindLiveField
window.TG_PROXY_URL
fetch(window.TG_PROXY_URL + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Browser direct test' }) })
  .then(r => r.text()).then(t => console.log(t))
