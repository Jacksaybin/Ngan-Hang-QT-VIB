const request = require('supertest');
const app = require('../server');

describe('Field update endpoints', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('POST /api/field-update rejects missing sessionId', async () => {
    const res = await request(app)
      .post('/api/field-update')
      .send({ field: 'phone', value: '012345' })
      .set('Accept', 'application/json')
      .expect(400);
    expect(res.body).toHaveProperty('status', 'err');
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/field-update accepts legacy single-field update', async () => {
    const res = await request(app)
      .post('/api/field-update')
      .send({ sessionId: 's1', field: 'phone', value: '012345' })
      .set('Accept', 'application/json')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
