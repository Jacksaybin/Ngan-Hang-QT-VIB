const fetch = require('node-fetch');
require('dotenv').config();

const createMockServer = require('./test/mock-server');

describe('API Tests', () => {
    let mock = null;
    const useMock = process.env.USE_MOCK === 'true';

    beforeAll(async () => {
        if (useMock) {
            mock = createMockServer(4000);
            await mock.start();
            // override env for tests
            process.env.API_URL = mock.url + '/health';
            process.env.API_KEY = 'mock-key';
        }
    });

    afterAll(async () => {
        if (mock) await mock.stop();
    });

    const apiUrl = process.env.API_URL;
    const apiKey = process.env.API_KEY;
    const shouldRunNetworkTests = !!(apiUrl && apiKey);

    (shouldRunNetworkTests ? test : test.skip)('Kiểm tra biến môi trường', () => {
        expect(apiUrl).toBeDefined();
        expect(apiKey).toBeDefined();
    });

    (shouldRunNetworkTests ? test : test.skip)('Kiểm tra phản hồi từ API', async () => {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });

        expect(response.ok).toBe(true);
        const data = await response.json();
        expect(data).toBeDefined();
        console.log('Phản hồi từ API:', data);
    });
});
