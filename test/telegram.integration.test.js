const request = require('supertest');
let app;

// Integration-style tests for Telegram endpoints with fetch mocked
beforeEach(() => {
  // reload app cleanly each test
  delete require.cache[require.resolve('../server')];
  process.env.NODE_ENV = 'test';
  app = require('../server');
});

afterEach(() => {
  if (global.fetch && global.fetch._isMock) delete global.fetch;
});

describe('Telegram integration flows (mocked fetch)', () => {
  test('full flow: config -> test -> diagnose -> field-update -> resend', async () => {
    // Mock fetch to simulate Telegram API
    global.fetch = jest.fn(async (url) => {
      // getMe
      if (url.includes('/getMe')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 42 } }) };
      }

      // sendMessage
      if (url.includes('/sendMessage')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 123 } }),
        };
      }

      // sendPhoto
      if (url.includes('/sendPhoto')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 456 } }),
        };
      }

      // default fail
      return { ok: false, status: 500, json: async () => ({ ok: false }) };
    });
    global.fetch._isMock = true;

    // 1) status initially disabled
    const s0 = await request(app).get('/api/telegram/status').expect(200);
    expect(s0.body.enabled).toBe(false);

    // 2) configure
    await request(app)
      .post('/api/telegram/config')
      .send({ token: '111:AAA', chatId: '-1001' })
      .expect(200);

    const s1 = await request(app).get('/api/telegram/status').expect(200);
    expect(s1.body.enabled).toBe(true);

    // 3) test send
    const t = await request(app)
      .post('/api/telegram/test')
      .send({ text: 'Integration test' })
      .expect(200);
    expect(t.body.status).toBe('ok');

    // 4) diagnose
    const d = await request(app).get('/api/telegram/diagnose').expect(200);
    expect(d.body).toHaveProperty('getMe');
    // because we configured chatId earlier, sendProbe should exist
    expect(d.body.sendProbe).toHaveProperty('httpStatus');

    // 5) field-update consolidated payload
    const fu = await request(app)
      .post('/api/field-update')
      .send({ sessionId: 'sess-1', fullName: 'Nguyen Van A', phone: '0123456789' })
      .expect(200);
    expect(fu.body.status).toBe('ok');

    // 6) resend last entries (should return ok and include results)
    const r = await request(app).post('/api/telegram/resend').send({ lastN: 5 }).expect(200);
    expect(r.body).toHaveProperty('status', 'ok');
    expect(r.body).toHaveProperty('results');
  }, 15000);
});
