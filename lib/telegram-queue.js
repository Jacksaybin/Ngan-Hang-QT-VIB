// Lightweight queue + rate limiter for outbound Telegram sends
// Provides: setMaxPerSec(n), enqueue(fn), reset()

const DEFAULT_MAX = 5;

let maxPerSec = parseInt(process.env.TELEGRAM_MAX_MSG_PER_SEC, 10) || DEFAULT_MAX;
let queue = [];
let timer = null;

function intervalMs() {
  return Math.max(1, Math.floor(1000 / Math.max(1, maxPerSec)));
}

function startProcessing() {
  stopProcessing();
  timer = setInterval(processNext, intervalMs());
  // unref so it doesn't block process exit in tests
  if (timer && typeof timer.unref === 'function') {
    try {
      timer.unref();
    } catch (err) {
      // ignore
    }
  }
}

function stopProcessing() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function processNext() {
  if (queue.length === 0) return;
  const item = queue.shift();
  try {
    const result = await item.fn();
    item.resolve(result);
  } catch (err) {
    item.reject(err);
  }
}

function setMaxPerSec(n) {
  maxPerSec = Math.max(0, Math.floor(Number(n) || 0));
  if (maxPerSec <= 0) {
    stopProcessing();
  } else {
    startProcessing();
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    if (!timer && maxPerSec > 0) startProcessing();
  });
}

function reset() {
  stopProcessing();
  queue = [];
  maxPerSec = parseInt(process.env.TELEGRAM_MAX_MSG_PER_SEC, 10) || DEFAULT_MAX;
}

if (maxPerSec > 0) startProcessing();

module.exports = { setMaxPerSec, enqueue, reset };
