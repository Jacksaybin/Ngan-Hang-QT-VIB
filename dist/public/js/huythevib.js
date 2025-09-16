// huythevib.js
var huythevib_default = {
  async fetch(request, env, ctx) {
    let { BOT_TOKEN, CHAT_ID, ORIGIN_WHITELIST, RATE_KV, REQUIRE_HMAC, HMAC_SECRET, DEBUG } = env;
    if (BOT_TOKEN) BOT_TOKEN = BOT_TOKEN.trim();
    if (CHAT_ID) CHAT_ID = CHAT_ID.trim();
    let chatIdSanitized = false;
    const originalChatId = CHAT_ID || "";
    if (CHAT_ID && !/^[-]?[0-9]+$/.test(CHAT_ID)) {
      const candidates = CHAT_ID.match(/-?[0-9]{5,}/g) || [];
      if (candidates.length) {
        let botIdTmp = BOT_TOKEN ? BOT_TOKEN.split(":", 1)[0] : "";
        let chosen = candidates[0];
        const neg = candidates.find((c) => c.startsWith("-"));
        if (neg) chosen = neg;
        else {
          const notBot = candidates.find((c) => c !== botIdTmp);
          if (notBot) chosen = notBot;
        }
        CHAT_ID = chosen;
        chatIdSanitized = true;
      }
    }
    const botIdFromToken = BOT_TOKEN ? BOT_TOKEN.split(":", 1)[0] : "";
    const chatIdLooksLikeBotId = botIdFromToken && CHAT_ID === botIdFromToken;
    const TG_API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (ORIGIN_WHITELIST || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const allowAll = allowed.includes("*");
    const okOrigin = allowAll || allowed.includes(origin);
    const corsOrigin = okOrigin ? origin || "*" : "null";
    function baseHeaders(extra = {}) {
      return {
        "Access-Control-Allow-Origin": corsOrigin,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        ...extra
      };
    }
    function json(obj, status = 200) {
      return new Response(JSON.stringify(obj), {
        status,
        headers: baseHeaders({ "Content-Type": "application/json" })
      });
    }
    if (request.method === "OPTIONS") return new Response(null, { headers: baseHeaders() });
    if (url.pathname === "/" && request.method === "GET") {
      return json({ status: "ok", endpoints: ["/sendMessage", "/sendDocument"] });
    }
    if (url.pathname === "/_envinfo" && request.method === "GET") {
      const rlWin = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || "600", 10);
      const rlMaxRaw = env.RATE_LIMIT_MAX;
      let rlMaxParsed = parseInt(rlMaxRaw || "60", 10);
      if (Number.isNaN(rlMaxParsed) || rlMaxParsed <= 0) rlMaxParsed = 60;
      const colonCount = BOT_TOKEN ? (BOT_TOKEN.match(/:/g) || []).length : 0;
      const tokenPatternOk = BOT_TOKEN ? /^[0-9]+:[A-Za-z0-9_-]{30,}$/.test(BOT_TOKEN) : false;
      const chatIdNumeric = CHAT_ID ? /^-?[0-9]+$/.test(CHAT_ID) : false;
      return json({
        has_bot_token: !!BOT_TOKEN,
        has_chat_id: !!CHAT_ID,
        bot_token_prefix: BOT_TOKEN ? BOT_TOKEN.slice(0, 10) : "",
        // <- (12) Chỉ hiển thị prefix BOT_TOKEN để debug an toàn
        bot_token_length: BOT_TOKEN ? BOT_TOKEN.length : 0,
        chat_id_length: CHAT_ID ? CHAT_ID.length : 0,
        bot_token_has_space: BOT_TOKEN ? /\s/.test(BOT_TOKEN) : false,
        chat_id_has_space: CHAT_ID ? /\s/.test(CHAT_ID) : false,
        bot_token_colon_count: colonCount,
        bot_token_pattern_ok: tokenPatternOk,
        chat_id_numeric: chatIdNumeric,
        chat_id_sanitized: chatIdSanitized,
        chat_id_looks_like_bot_id: chatIdLooksLikeBotId,
        // <- (13) Cờ cảnh báo CHẠY SAI CHAT_ID
        original_chat_id_length: originalChatId.length,
        original_chat_id_prefix: originalChatId ? originalChatId.slice(0, 8) : "",
        hmac_enabled: REQUIRE_HMAC === "1",
        rate_limit_window: rlWin,
        rate_limit_max: rlMaxParsed,
        kv_bound: !!RATE_KV
      });
    }
    const RL_WINDOW = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || "600", 10);
    const RL_MAX = parseInt(env.RATE_LIMIT_MAX || "60", 10);
    const now = Date.now();
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
    const windowId = Math.floor(now / (RL_WINDOW * 1e3));
    if (!globalThis.__rl_mem) globalThis.__rl_mem = /* @__PURE__ */ new Map();
    const mem = globalThis.__rl_mem;
    async function checkAndIncRate() {
      const keyBase = `${ip}:${windowId}`;
      if (RATE_KV) {
        const kvKey = `rl:${keyBase}`;
        let current = await RATE_KV.get(kvKey);
        let count = current ? parseInt(current, 10) : 0;
        if (count >= RL_MAX) return false;
        count++;
        const ttl = RL_WINDOW * 1e3 - (now - windowId * RL_WINDOW * 1e3);
        await RATE_KV.put(kvKey, String(count), { expirationTtl: Math.max(Math.ceil(ttl / 1e3), 1) });
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
        if (mem.size > 5e3) {
          for (const [k, v] of mem.entries()) {
            if (v.windowId !== windowId) mem.delete(k);
          }
        }
        return true;
      }
    }
    function rateLimitExceededResponse(remainingSec) {
      const body = { error: "rate_limited", retry_after_seconds: remainingSec };
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: baseHeaders({
          "Content-Type": "application/json",
          "Retry-After": String(remainingSec)
        })
      });
    }
    async function verifyHmacIfEnabled(rawBody, headers) {
      if (REQUIRE_HMAC !== "1") return true;
      if (!HMAC_SECRET) return false;
      const sig = headers.get("x-signature");
      const ts = headers.get("x-timestamp");
      const nonce = headers.get("x-nonce");
      if (!sig || !ts || !nonce) return false;
      const tsNum = parseInt(ts, 10);
      if (!tsNum || Math.abs(Date.now() - tsNum) > 5 * 60 * 1e3) return false;
      const data = `${rawBody}.${ts}.${nonce}`;
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
      const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return expected === sig.toLowerCase();
    }
    if (url.pathname === "/sendMessage" && request.method === "POST") {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: "Server not configured" }, 500);
      if (chatIdLooksLikeBotId) {
        return json({ error: "chat_id_looks_like_bot_id", hint: "CHAT_ID ph\u1EA3i l\xE0 message.chat.id l\u1EA5y t\u1EEB getUpdates (private: user id ri\xEAng; group: \xE2m -100...), kh\xF4ng ph\u1EA3i ph\u1EA7n s\u1ED1 \u0111\u1EA7u c\u1EE7a BOT_TOKEN." }, 400);
      }
      let raw = "";
      try {
        raw = await request.text();
      } catch {
      }
      if (!await verifyHmacIfEnabled(raw, request.headers)) {
        return json({ error: "invalid_signature" }, 401);
      }
      let payload;
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const text = (payload.text || "").toString().trim();
      if (!text) return json({ error: "text required" }, 400);
      const allowed2 = await checkAndIncRate();
      if (!allowed2) {
        const remainingSec = Math.max(
          Math.ceil(((windowId + 1) * RL_WINDOW * 1e3 - Date.now()) / 1e3),
          1
        );
        return rateLimitExceededResponse(remainingSec);
      }
      try {
        const tgUrl = `${TG_API_BASE}/sendMessage`;
        const basePayload = {
          chat_id: CHAT_ID,
          // <- (18) Truyền CHAT_ID vào Telegram
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true
        };
        if (DEBUG === "1") console.log("[sendMessage] attempt#1 markdown", tgUrl, { len: text.length });
        let tgRes = await fetch(tgUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload)
        });
        let data = await tgRes.json().catch(() => ({}));
        const desc = data && data.description ? String(data.description).toLowerCase() : "";
        const isParseErr = tgRes.status === 400 && /parse|entity/.test(desc);
        if (isParseErr) {
          if (DEBUG === "1") console.log("[sendMessage] markdown parse error, retrying without parse_mode", desc);
          const plainPayload = { chat_id: CHAT_ID, text, disable_web_page_preview: true };
          tgRes = await fetch(tgUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(plainPayload)
          });
          const data2 = await tgRes.json().catch(() => ({}));
          if (DEBUG === "1") console.log("[sendMessage] attempt#2 plain status", tgRes.status, data2);
          return json(data2, tgRes.ok ? 200 : tgRes.status);
        }
        if (DEBUG === "1") {
          console.log("[sendMessage] status", tgRes.status, data);
          if (tgRes.status === 404) {
            console.log("[sendMessage] 404 debug prefix", BOT_TOKEN ? BOT_TOKEN.slice(0, 15) : "NO_TOKEN");
          }
        }
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        if (DEBUG === "1") console.log("[sendMessage] exception", e);
        return json({ error: "telegram_request_failed", detail: e.message }, 502);
      }
    }
    if (url.pathname === "/sendDocument" && request.method === "POST") {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: "Server not configured" }, 500);
      if (chatIdLooksLikeBotId) {
        return json({ error: "chat_id_looks_like_bot_id", hint: "CHAT_ID ph\u1EA3i l\xE0 message.chat.id l\u1EA5y t\u1EEB getUpdates (private: user id ri\xEAng; group: \xE2m -100...), kh\xF4ng ph\u1EA3i ph\u1EA7n s\u1ED1 \u0111\u1EA7u c\u1EE7a BOT_TOKEN." }, 400);
      }
      let form;
      try {
        form = await request.formData();
      } catch {
        return json({ error: "Expected multipart/form-data" }, 400);
      }
      if (REQUIRE_HMAC === "1") {
        if (!HMAC_SECRET) return json({ error: "invalid_signature" }, 401);
      }
      const file = form.get("document");
      if (!(file instanceof File)) return json({ error: "document file required" }, 400);
      if (file.size > 15 * 1024 * 1024) return json({ error: "document too large (>15MB)" }, 413);
      const caption = (form.get("caption") || "").toString().slice(0, 1e3);
      const allowed2 = await checkAndIncRate();
      if (!allowed2) {
        const remainingSec = Math.max(
          Math.ceil(((windowId + 1) * RL_WINDOW * 1e3 - Date.now()) / 1e3),
          1
        );
        return rateLimitExceededResponse(remainingSec);
      }
      const fd = new FormData();
      fd.append("chat_id", CHAT_ID);
      fd.append("document", file, file.name || "file");
      if (caption) fd.append("caption", caption);
      try {
        const tgUrl = `${TG_API_BASE}/sendDocument`;
        if (DEBUG === "1") {
          console.log("[sendDocument] url", tgUrl);
        }
        const tgRes = await fetch(tgUrl, {
          method: "POST",
          body: fd
        });
        const data = await tgRes.json().catch(() => ({}));
        if (DEBUG === "1") {
          console.log("[sendDocument] status", tgRes.status, data);
          if (tgRes.status === 404) {
            console.log("[sendDocument] 404 debug prefix", BOT_TOKEN ? BOT_TOKEN.slice(0, 15) : "NO_TOKEN");
          }
        }
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        if (DEBUG === "1") console.log("[sendDocument] exception", e);
        return json({ error: "telegram_request_failed", detail: e.message }, 502);
      }
    }
    return json({ error: "Not found" }, 404);
  }
};
window.TG_PROXY_URL;
fetch(window.TG_PROXY_URL + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Browser direct test" }) }).then((r) => r.text()).then((t) => console.log(t));
export {
  huythevib_default as default
};
//# sourceMappingURL=huythevib.js.map
