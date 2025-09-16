var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// huythevib.js
var huythevib_default = {
  async fetch(request, env, ctx) {
    const { BOT_TOKEN, CHAT_ID, ORIGIN_WHITELIST, RATE_KV, REQUIRE_HMAC, HMAC_SECRET } = env;
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
    __name(baseHeaders, "baseHeaders");
    function json(obj, status = 200) {
      return new Response(JSON.stringify(obj), {
        status,
        headers: baseHeaders({ "Content-Type": "application/json" })
      });
    }
    __name(json, "json");
    if (request.method === "OPTIONS") return new Response(null, { headers: baseHeaders() });
    if (url.pathname === "/" && request.method === "GET") {
      return json({ status: "ok", endpoints: ["/sendMessage", "/sendDocument"] });
    }
    if (url.pathname === "/_envinfo" && request.method === "GET") {
      return json({
        has_bot_token: !!BOT_TOKEN,
        has_chat_id: !!CHAT_ID,
        hmac_enabled: REQUIRE_HMAC === "1",
        rate_limit_window: parseInt(env.RATE_LIMIT_WINDOW_SECONDS || "600", 10),
        rate_limit_max: parseInt(env.RATE_LIMIT_MAX || "60", 10),
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
    __name(checkAndIncRate, "checkAndIncRate");
    function rateLimitExceededResponse(remainingSec) {
      const body = { error: "rate_limited", retry_after_seconds: remainingSec };
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: baseHeaders({
          "Content-Type": "application/json",
          // Chuẩn HTTP cho client biết bao lâu nên đợi. Dùng giây (integer) cho đơn giản.
          "Retry-After": String(remainingSec)
        })
      });
    }
    __name(rateLimitExceededResponse, "rateLimitExceededResponse");
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
    __name(verifyHmacIfEnabled, "verifyHmacIfEnabled");
    if (url.pathname === "/sendMessage" && request.method === "POST") {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: "Server not configured" }, 500);
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
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
          })
        });
        const data = await tgRes.json().catch(() => ({}));
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        return json({ error: "telegram_request_failed", detail: e.message }, 502);
      }
    }
    if (url.pathname === "/sendDocument" && request.method === "POST") {
      if (!BOT_TOKEN || !CHAT_ID) return json({ error: "Server not configured" }, 500);
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
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
          method: "POST",
          body: fd
        });
        let data;
        try {
          data = await tgRes.json();
        } catch {
          data = { ok: false };
        }
        return json(data, tgRes.ok ? 200 : tgRes.status);
      } catch (e) {
        return json({ error: "telegram_request_failed", detail: e.message }, 502);
      }
    }
    return json({ error: "Not Found" }, 404);
  }
};
export {
  huythevib_default as default
};
//# sourceMappingURL=huythevib.js.map
