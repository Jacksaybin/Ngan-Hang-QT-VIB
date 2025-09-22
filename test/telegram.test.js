const request = require('supertest');
let app;
const reloadApp = () => {
  // ensure module cache cleared so server module re-reads process.env
  delete require.cache[require.resolve('../server')];
  app = require('../server');
};

describe('/api/telegram endpoints', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    reloadApp();
  });
  afterEach(() => {
    process.env = originalEnv;
    if (global.fetch && global.fetch._isMock) {
      delete global.fetch;
    }
  });

  test('GET /api/telegram/status returns enabled=false when not configured', async () => {
    const res = await request(app).get('/api/telegram/status').expect(200);
    expect(res.body).toHaveProperty('enabled', false);
  });

  test('POST /api/telegram/config updates config and /status reflects it', async () => {
    const cfg = { token: '123:ABC', chatId: '-1001', allowRawSensitive: true, receiveOnly: false };
    const r1 = await request(app).post('/api/telegram/config').send(cfg).expect(200);
    expect(r1.body).toHaveProperty('status', 'ok');
    const r2 = await request(app).get('/api/telegram/status').expect(200);
    expect(r2.body).toHaveProperty('hasToken', true);
    expect(r2.body).toHaveProperty('hasChatId', true);
  });

  test('POST /api/telegram/test returns 400 when telegram not enabled', async () => {
    // Clear env to ensure disabled
    process.env.TELEGRAM_BOT_TOKEN = '';
    const res = await request(app).post('/api/telegram/test').send({ text: 'hi' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('status', 'err');
  });

  test('POST /api/telegram/test attempts send when configured (mock fetch)', async () => {
    // Configure token and chatId via API so server's runtime config is updated
    await request(app)
      .post('/api/telegram/config')
      .send({ token: '123:ABC', chatId: '-1001' })
      .expect(200);

    // mock fetch to simulate Telegram API
    global.fetch = jest.fn(async (url) => {
      // getMe call
      if (url.includes('/getMe')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 1 } }) };
      }
      // sendMessage
      if (url.includes('/sendMessage')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 1 } }),
        };
      }
      return { ok: false, status: 500, json: async () => ({ ok: false }) };
    });
    global.fetch._isMock = true;

    const res = await request(app).post('/api/telegram/test').send({ text: 'hello' }).expect(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('GET /api/telegram/diagnose returns getMe result and skipped sendProbe when no chatId', async () => {
    // Configure token only (no chatId)
    await request(app)
      .post('/api/telegram/config')
      .send({ token: '123:ABC', chatId: '' })
      .expect(200);

    global.fetch = jest.fn(async (url) => {
      if (url.includes('/getMe')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 500, json: async () => ({ ok: false }) };
    });
    global.fetch._isMock = true;

    const res = await request(app).get('/api/telegram/diagnose').expect(200);
    expect(res.body).toHaveProperty('getMe');
    expect(res.body.sendProbe).toHaveProperty('skipped');
  });
});
