const fetch = require('node-fetch');
require('dotenv').config();

const createMockServer = require('./test/mock-server');

describe('API Tests', () => {
    let mock = null;
    const useMock = process.env.USE_MOCK === 'true';
    let apiUrl;
    let apiKey;

    beforeAll(async () => {
        if (useMock) {
            mock = createMockServer(4000);
            await mock.start();
            // set envs to mock
            process.env.API_URL = mock.url + '/health';
            process.env.API_KEY = 'mock-key';
        }
        apiUrl = process.env.API_URL;
        apiKey = process.env.API_KEY;
    });

    afterAll(async () => {
        if (mock) await mock.stop();
    });

    const shouldRunNetworkTests = useMock || (!!process.env.API_URL && !!process.env.API_KEY);

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
