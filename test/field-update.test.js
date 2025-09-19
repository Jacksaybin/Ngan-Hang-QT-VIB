const request = require('supertest');
const app = require('../server-mock');

describe('field-update endpoints (mock app via supertest)', () => {
    test('per-field endpoint masks card number and returns ok', async () => {
        const cardNumber = '4111222233334444';
        const res = await request(app).post('/api/field-update/cardNumber').send({ value: cardNumber });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('field', 'cardNumber');

        const logsRes = await request(app).get('/api/logs');
        expect(logsRes.status).toBe(200);
        const logsJson = logsRes.body;
        const found = logsJson.logs.reverse().find(e => e.field === 'cardNumber' || (e.body && e.body.field === 'cardNumber'));
        expect(found).toBeDefined();
        const val = found.value || (found.body && (found.body.value || found.body));
        const str = typeof val === 'string' ? val : JSON.stringify(val);
        expect(str).toContain('4111');
        expect(str).toContain('4444');
        expect(str).not.toContain(cardNumber);
    });

    test('generic /api/field-update masks otp-like values', async () => {
        const otp = '123456';
        const res = await request(app).post('/api/field-update').send({ field: 'otp', value: otp });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');

        const logsRes = await request(app).get('/api/logs');
        const logsJson = logsRes.body;
        const found = logsJson.logs.reverse().find(e => (e.body && e.body.field === 'otp') || e.field === 'otp');
        expect(found).toBeDefined();
        const val = (found.body && found.body.value) || found.value || found.body;
        const str = typeof val === 'string' ? val : JSON.stringify(val);
        expect(str).not.toContain(otp);
        expect(str).toContain('6');
    });
});
