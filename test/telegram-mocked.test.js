const request = require('supertest');
const nock = require('nock');
const app = require('../vib-tele-api/server');

describe('Telegram endpoints (mocked)', () => {
    afterEach(() => {
        nock.cleanAll();
    });

    test('POST /api/telegram/test should echo body', async () => {
        const payload = { foo: 'bar' };
        const res = await request(app).post('/api/telegram/test').send(payload).expect(200);
        expect(res.body).toEqual({ status: 'ok', echo: payload });
    });

    test('GET /api/telegram/status should report token/chat flags', async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'TEST';
        process.env.TELEGRAM_CHAT_ID = '12345';

        const res = await request(app).get('/api/telegram/status').expect(200);
        expect(res.body).toMatchObject({ status: 'ok', tokenSet: true, chatIdSet: true });

        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;
    });

    test('demonstrate nock for Telegram API (server currently does not call)', async () => {
        const tg = nock('https://api.telegram.org')
            .post(/bot.*\/sendMessage/)
            .reply(200, { ok: true, result: { message_id: 1 } });

        const res = await request(app).post('/api/telegram/test').send({ ping: 'tg' }).expect(200);
        expect(res.body.status).toBe('ok');
        // server does not call Telegram for this route, so nock should not be consumed
        expect(tg.isDone()).toBe(false);
    });
});
