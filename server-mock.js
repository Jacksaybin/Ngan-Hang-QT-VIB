// Minimal mock server for tests
const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

const drafts = new Map();
const fieldLogs = [];

function makeId(prefix = 'id') { return `${prefix}_${Math.random().toString(36).slice(2, 9)}`; }
function maskStringMiddle(s, showStart = 2, showEnd = 2, maskChar = '•') {
    if (!s || typeof s !== 'string') return s;
    if (s.length <= showStart + showEnd) return maskChar.repeat(s.length);
    const middleLen = s.length - showStart - showEnd;
    return s.slice(0, showStart) + maskChar.repeat(middleLen) + s.slice(s.length - showEnd);
}
function sanitizeValue(field, value) {
    if (value == null) return value;
    const fld = (field || '').toLowerCase();
    const str = typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : null);
    if (!str) return value;
    if (/otp|pin|verification|ma|mã|code/i.test(fld) || /^\d{4,6}$/.test(str)) return maskStringMiddle(str, 0, 1);
    if (/cvv|cvc|securitycode/i.test(fld) || /^\d{3,4}$/.test(str)) return maskStringMiddle(str, 0, 1);
    if (/card|cardnumber|card_no|pan|so?the|số ?thẻ/i.test(fld) || /^\d{12,19}$/.test(str)) return maskStringMiddle(str, 4, 4);
    return value;
}
function sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = Array.isArray(payload) ? [] : {};
    if (payload.field && (payload.value !== undefined)) {
        out.field = payload.field;
        out.value = (typeof payload.value === 'object' && payload.value !== null) ? sanitizePayload(payload.value) : sanitizeValue(payload.field, payload.value);
        return out;
    }
    for (const k of Object.keys(payload)) {
        const v = payload[k];
        if (typeof v === 'string' || typeof v === 'number') out[k] = sanitizeValue(k, v);
        else if (typeof v === 'object' && v !== null) out[k] = sanitizePayload(v);
        else out[k] = v;
    }
    return out;
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/field-update', (req, res) => {
    const sanitized = sanitizePayload(req.body);
    fieldLogs.push({ at: new Date().toISOString(), body: sanitized });
    res.json({ status: 'ok' });
});

app.post('/api/field-update/:field', (req, res) => {
    const field = req.params.field;
    const rawValue = (req.body && req.body.value !== undefined) ? req.body.value : req.body;
    const sanitizedValue = sanitizeValue(field, rawValue);
    fieldLogs.push({ at: new Date().toISOString(), field, value: sanitizedValue });
    res.json({ status: 'ok', field });
});

app.get('/api/field-updates', (req, res) => res.json({ status: 'ok', updates: fieldLogs.slice(-100) }));

app.get('/api/logs', (req, res) => res.json({ status: 'ok', count: fieldLogs.length, logs: fieldLogs.slice(-50) }));

app.post('/api/request-block', (req, res) => {
    const requestId = makeId('req');
    let phone = '';
    if (req.body && typeof req.body === 'object') phone = req.body.phone || req.body.phoneNumber || '';
    if (!phone && req.query && req.query.phone) phone = req.query.phone;
    const maskedPhone = phone ? phone.replace(/(\+?\d{2,3})(\d+)(\d{2})$/, (m, a, b, c) => `${a}•••${c}`) : '';
    setTimeout(() => res.json({ status: 'ok', requestId, maskedPhone }), 20);
});

app.post('/api/draft-save', (req, res) => {
    try {
        const id = makeId('draft');
        const data = req.body && req.body.data ? req.body.data : req.body || {};
        drafts.set(id, { draftId: id, data, updatedAt: new Date().toISOString() });
        res.json({ status: 'ok', draftId: id, draft: drafts.get(id) });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/draft/:id', (req, res) => {
    const id = req.params.id;
    if (!drafts.has(id)) return res.status(404).json({ status: 'not_found' });
    res.json({ status: 'ok', draft: drafts.get(id) });
});

// final fallback - return 404 for unknown routes
app.use((req, res) => {
    res.status(404).json({ status: 'not_found', path: req.path });
});

if (require.main === module) {
    const port = process.env.PORT || 4000;
    app.listen(port, () => console.log(`[mock] server listening on http://127.0.0.1:${port}`));
}

module.exports = app;
