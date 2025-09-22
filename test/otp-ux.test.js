const request = require('supertest');
const nock = require('nock');
const app = require('../vib-tele-api/server');

describe('OTP UX endpoints', () => {
    afterEach(() => nock.cleanAll());

    test('POST /api/request-block returns requestId, maskedPhone and TTL (test mode exposes code)', async () => {
        const res = await request(app).post('/api/request-block').send({ phone: '+84123456789' }).expect(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.requestId).toBeTruthy();
        expect(res.body.maskedPhone).toBeTruthy();
        expect(res.body.ttlSeconds).toBeGreaterThan(0);
        // In test mode code is exposed
        expect(res.body.code).toMatch(/^[0-9]{6}$/);
    });

    test('POST /api/verify-otp with correct code verifies', async () => {
        // create request
        const r1 = await request(app).post('/api/request-block').send({ phone: '+84900111222' }).expect(200);
        const { requestId, code } = r1.body;
        const r2 = await request(app).post('/api/verify-otp').send({ requestId, code }).expect(200);
        expect(r2.body.status).toBe('ok');
        expect(r2.body.verified).toBe(true);
    });

    test('POST /api/verify-otp with wrong code notifies Telegram on repeated failures (mocked)', async () => {
        // ensure telegram env present so server will attempt notify
        process.env.TELEGRAM_BOT_TOKEN = 'TEST';
        process.env.TELEGRAM_CHAT_ID = '12345';

        // mock Telegram sendMessage endpoint (called by telegramSend)
        const tg = nock('https://api.telegram.org')
            .post(/bot.*\/sendMessage/)
            .reply(200, { ok: true, result: { message_id: 1 } });

        const r1 = await request(app).post('/api/request-block').send({ phone: '+84900999888' }).expect(200);
        const { requestId } = r1.body;

        // Submit wrong code enough times to trigger a notify or limit
        await request(app).post('/api/verify-otp').send({ requestId, code: '111111' });
        await request(app).post('/api/verify-otp').send({ requestId, code: '222222' });
        // third wrong attempt should trigger either notify or block
        const r3 = await request(app).post('/api/verify-otp').send({ requestId, code: '333333' });
        // r3 may be 429 or 422 depending on attempts logic; wait briefly so the
        // rate-limited queue has a chance to process the notification and let nock
        // observe the outgoing HTTP call.
        await new Promise((r) => setTimeout(r, 800));
        expect(tg.isDone()).toBe(true);

        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;
    }, 10000);
});
