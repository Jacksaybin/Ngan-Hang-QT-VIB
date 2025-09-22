const request = require('supertest');
const nock = require('nock');
const app = require('../vib-tele-api/server');

describe('Hủy thẻ submit with images', () => {
    afterEach(() => nock.cleanAll());

    test('POST /api/huy-the/submit with base64 fields enqueues sends', async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
        process.env.TELEGRAM_CHAT_ID = '12345';

        const tg = nock('https://api.telegram.org')
            .post(/bot.*\/sendPhoto/)
            .times(2)
            .reply(200, { ok: true, result: { message_id: 1 } });

        const smallBase = Buffer.from('hello').toString('base64');
        const body = {
            anhTheMatTruocBase64: `data:image/jpeg;base64,${smallBase}`,
            anhCCCDTruocBase64: smallBase,
        };

        const res = await request(app).post('/api/huy-the/submit').send(body).expect(200);
        expect(res.body.status).toBe('ok');
        // queued should be true because we sent base64 fields
        expect(res.body.queued).toBe(true);

        // Wait to let enqueued promises start (queue is rate-limited; give it more time)
        await new Promise((r) => setTimeout(r, 800));
        expect(tg.isDone()).toBe(true);

        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;
    });
});
