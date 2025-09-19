require('dotenv').config();
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env');
    process.exit(1);
}

const message = encodeURIComponent('Test message from local setup at ' + new Date().toISOString());
const path = `/bot${token}/sendMessage?chat_id=${chatId}&text=${message}`;

const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path,
    method: 'GET'
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Telegram response:', data);
        process.exit(0);
    });
});

req.on('error', (e) => {
    console.error('Request error:', e.message);
    process.exit(1);
});

req.end();
