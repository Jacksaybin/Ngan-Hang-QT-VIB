const fetch = require('node-fetch');
require('dotenv').config();

// Kiểm tra các biến môi trường
const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;

if (!apiUrl || !apiKey) {
  console.error('❌ API_URL hoặc API_KEY không được cấu hình trong file .env');
  process.exit(1);
}

console.log('✅ API_URL:', apiUrl);
console.log('✅ API_KEY:', apiKey);

// Gửi request thử nghiệm đến API
(async () => {
  try {
    console.log('🔄 Đang gửi request đến API...');
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`❌ Lỗi HTTP! Status: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Phản hồi từ API:', data);
  } catch (error) {
    console.error('❌ Lỗi khi gọi API:', error.message);
  }
})();
