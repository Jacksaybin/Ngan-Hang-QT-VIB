const request = require('supertest');
const app = require('../server-mock');

describe('/api/field-updates list endpoint', () => {
    test('records multiple updates and returns them via /api/field-updates', async () => {
        await request(app).post('/api/field-update/name').send({ value: 'Alice' });
        await request(app).post('/api/field-update/phone').send({ value: '+84901234567' });

        const res = await request(app).get('/api/field-updates');
        expect(res.status).toBe(200);
        const json = res.body;
        expect(json).toHaveProperty('status', 'ok');
        expect(json).toHaveProperty('updates');
        expect(Array.isArray(json.updates)).toBe(true);
        expect(json.updates.length).toBeGreaterThanOrEqual(2);
        const names = json.updates.map(u => u.field || (u.body && u.body.field) || null);
        expect(names).toEqual(expect.arrayContaining(['name', 'phone']));
    });
});
