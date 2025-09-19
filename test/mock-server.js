const express = require('express');

function createMockServer(port = 4000) {
    const app = express();

    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    let server = null;
    return {
        start: () => new Promise((resolve) => { server = app.listen(port, resolve); }),
        stop: () => new Promise((resolve) => { if (server) server.close(resolve); else resolve(); }),
        url: `http://localhost:${port}`
    };
}

module.exports = createMockServer;
