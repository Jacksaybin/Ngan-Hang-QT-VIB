const request = require('supertest');
const path = require('path');

// Helper to reload app fresh for each test to avoid persisted config state
function loadApp() {
  // clear cache for server to ensure fresh in-memory state
  const p = path.join(__dirname, '..', 'server.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

describe('Flow: Hủy thẻ -> Gửi yêu cầu -> OTP', () => {
  let app;

  beforeAll(() => {
    // Mock global.fetch used by server when sending Telegram messages
    global.fetch = jest.fn(async (url) => {
      // Simple heuristic: /bot<token>/getMe -> return ok
      if (String(url).includes('/getMe')) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { username: 'vib_test_bot' } }),
        };
      }
      // sendMessage or sendPhoto -> simulate telegram success
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 123 } }),
      };
    });
  });

  afterAll(() => {
    // restore fetch if needed
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

  test('POST /api/request-block accepts form and responds with requestId', async () => {
    const res = await request(app)
      .post('/api/request-block')
      .field('holderName', 'Nguyen Van A')
      .field('phone', '+84900111222')
      .field('reason', 'Làm thất lạc thẻ');

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.body).toBeDefined();
    expect(res.body.status).toBe('ok');
    expect(res.body.requestId).toBeDefined();
  });

  test('OTP flow: POST /api/verify-otp accepts code and verifies', async () => {
    // First create a request to get requestId
    const create = await request(app)
      .post('/api/request-block')
      .field('holderName', 'Nguyen Van B')
      .field('phone', '+84900111333')
      .field('reason', 'Nghi ngờ giao dịch');

    expect(create.status).toBeGreaterThanOrEqual(200);
    expect(create.body && create.body.requestId).toBeDefined();

    const requestId = create.body.requestId;

    // The server may expect OTP to be numeric; use '000000' as dummy
    const otpRes = await request(app)
      .post('/api/verify-otp')
      .send({ requestId, code: '000000' })
      .set('Accept', 'application/json');

    // Accept either success or an expected validation error shape, but should not crash
    expect([200, 400, 422]).toContain(otpRes.status);
    // If success, expect body.status==='ok'
    if (otpRes.status === 200) {
      expect(otpRes.body && otpRes.body.status).toBe('ok');
    }
  });
});
