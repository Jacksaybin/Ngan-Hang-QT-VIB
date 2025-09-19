const request = require('supertest');
const app = require('../server-mock');

describe('request-block and draft endpoints', () => {
    test('/api/request-block returns masked phone and requestId', async () => {
        const payload = { phone: '+84901234567' };
        const res = await request(app).post('/api/request-block').send(payload);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('requestId');
        expect(res.body).toHaveProperty('maskedPhone');
        expect(res.body.maskedPhone).not.toContain(payload.phone);
    });

    test('/api/draft-save saves and returns draftId', async () => {
        const data = { data: { name: 'Test', phone: '+84909998877' } };
        const res = await request(app).post('/api/draft-save').send(data);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('draftId');
        expect(res.body).toHaveProperty('draft');
        expect(res.body.draft).toHaveProperty('data');
    });
});
