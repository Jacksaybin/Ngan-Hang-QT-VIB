# Hướng dẫn triển khai dự án lên VPS

Tài liệu này mô tả hai cách triển khai dự án từ repository của bạn lên VPS:

- Cách A (khuyến nghị): Server tự kéo mã từ GitHub (server-pull) — dùng `scripts/auto-deploy.sh` có sẵn.
- Cách B: Đẩy từ máy local (Windows PowerShell) sang VPS (local-push) — dùng `scripts/deploy-to-vps.ps1` (đã thêm).

Mục tiêu: cung cấp các lệnh từng bước (bash/PowerShell), cách thêm Deploy Key vào GitHub, và xử lý khi SSH bị chặn (dùng VNC/console).

---

PHẦN A — Server-pull (Khuyến nghị)

Ý tưởng: chạy `scripts/auto-deploy.sh` trên VPS dưới quyền `root`. Script sẽ:
- Tạo user deploy (nếu chưa có), tạo key ed25519 cho user deploy và in public key để bạn copy sang GitHub.
- Tự động thêm host key của Git host vào `known_hosts`.
- Clone repo bằng SSH (hoặc HTTPS nếu bạn chỉ cung cấp URL HTTPS).
- Chạy `npm install --production` và khởi động app bằng `pm2`.

Khi dùng phương pháp này, bạn không cần lưu private key trên máy phát triển; VPS giữ private key và dùng nó để kéo mã.

Bước 1 — Đăng nhập vào VPS

- Nếu SSH hoạt động, từ PowerShell chạy:

```powershell
ssh root@103.81.86.107 -p 22
```

- Nếu `Connection refused` hoặc SSH bị đóng, dùng VNC tạm thời (URL bạn cung cấp) để mở console web và đăng nhập bằng mật khẩu `sR*u8c!ZX`. Link VNC tạm thời:

https://cloud2.mt0epx1xktys7uk7f1tcloud-vnc.vip:6080/vnc_auto.html?path=%3Ftoken%3D47507802-201a-4b13-a6f4-b67376d1f11b

Bước 2 — Chạy `auto-deploy.sh`

- Copy file `scripts/auto-deploy.sh` lên VPS hoặc clone repo trước (nếu repo đã có trên VPS). Nếu bạn đã upload repo files to `/root` hoặc nơi nào đó, đi đến thư mục chứa `scripts/auto-deploy.sh`.

Giả sử bạn đã có `auto-deploy.sh` trên VPS, chạy (vẫn ở quyền root):

```bash
chmod +x scripts/auto-deploy.sh
# Gọi script; tham số: deploy_user repo_url app_dir
# Ví dụ: deploy user = deploy, repo SSH = git@github.com:YOUR_ORG/YOUR_REPO.git, app dir = /home/deploy/app
./scripts/auto-deploy.sh deploy git@github.com:YOUR_ORG/YOUR_REPO.git /home/deploy/app
```

- Nếu bạn không muốn chạy bootstrap (nó sẽ chạy `bootstrap-ubuntu-server.sh` nếu có), bạn có thể mở script và đọc các bước.

Bước 3 — Thêm Deploy Key vào GitHub

Khi chạy `auto-deploy.sh`, script sẽ sinh một cặp ed25519 cho user `deploy` và in ra public key (đường dẫn `~/.ssh/id_ed25519.pub` hoặc in trực tiếp). Copy nội dung public key (bắt đầu `ssh-ed25519 AAAA...`) rồi:

1. Mở trang GitHub repo của bạn → Settings → Deploy keys → Add deploy key.
2. Dán public key vào, đặt tên, chọn `Allow write access` nếu bạn muốn cho VPS quyền push (thường chỉ cần read → không tick).
3. Lưu.

Sau khi thêm key, script sẽ thử `git clone` lần nữa (nếu clone trước đó thất bại). Nếu thành công, nó sẽ chạy `npm install --production` và khởi động bằng `pm2`.

Bước 4 — Kiểm tra

```bash
# Kiểm tra pm2
pm2 ls
# Kiểm tra logs
pm2 logs vib-server --lines 200
# Kiểm tra tệp config và port
cat /home/deploy/app/ecosystem.config.js
```

Xử lý khi SSH bị chặn
- Dùng VNC/console tạm thời (link ở trên) để đăng nhập và chạy script từ giao diện shell của nhà cung cấp.
- Nếu firewall chặn, kiểm tra `ufw status` hoặc provider firewall, mở port 22 tạm thời để SSH.

---

PHẦN B — Local-push (đã có script PowerShell)

Tập trung cho Windows PowerShell: `scripts/deploy-to-vps.ps1`.

Mục đích: bạn chạy script này từ repo local; script:
- Tạo file `deploy-<timestamp>.tar` của Git HEAD (hoặc fallback archive),
- SCP file lên VPS `/tmp/` (dùng SSH key bạn chỉ định),
- Trên VPS: giải nén vào `-RemotePath`, chạy `npm install --production`, và restart/start pm2.

Ví dụ lệnh PowerShell (chạy từ thư mục repo root):

```powershell
# Ví dụ: deploy tới root bằng key private
.\scripts\deploy-to-vps.ps1 -Host 103.81.86.107 -User root -KeyPath $env:USERPROFILE\.ssh\id_ed25519 -RemotePath /var/www/vib -UseSudo
```

Các tham số quan trọng:
- `-Host` : IP của VPS.
- `-User` : user trên VPS (ví dụ: `deploy` hoặc `root`).
- `-KeyPath` : đường dẫn tới private key trên máy local (mặc định `$env:USERPROFILE\.ssh\id_ed25519`).
- `-RemotePath` : thư mục đích trên VPS.
- `-UseSudo` : dùng sudo khi cần trên VPS (ví dụ ghi vào `/var/www`).

Lưu ý an toàn
- Không upload private key lên VPS.
- Tốt nhất: tạo user `deploy` không phải root, cấp quyền sở hữu thư mục deploy cho user đó, và dùng Deploy Key (server-pull) hoặc private key cho `scp` (local-push).

---

Xử lý lỗi phổ biến

1) `scp` / `ssh` không tìm thấy trên Windows
- Cài OpenSSH Client (Windows) hoặc chạy trong WSL (Ubuntu) nếu cần.

2) `Permission denied (publickey)` khi `git clone`
- Cần thêm public key (được in ra bởi `auto-deploy.sh`) vào GitHub as Deploy Key hoặc vào account SSH keys.

3) `Connection refused` tới port 22
- Dùng VNC/console nhà cung cấp để truy cập máy và kiểm tra `sshd`:

```bash
systemctl status ssh
ss -ltnp | grep :22
ufw status
journalctl -u ssh -n 200
```

4) `npm install` lỗi do network
- Kiểm tra DNS / proxy trên VPS, hoặc chạy `npm ci` nếu bạn có `package-lock.json`.

---

Ghi chú về thời hạn cloud
- Bạn cung cấp: Cloud ID: `a7d98546-691d-4510-b2f7-208e3f9d3ab2`, Project ID: `525647a96d1346c698a9b64a8398121e`.
- Hạn sử dụng tạm thời: 20-09-2025 → 20-10-2025 — nhớ kiểm tra và gia hạn nếu cần.

---

Muốn mình làm gì tiếp theo?
- (A) Mình soạn thêm `scripts/auto-deploy.sh` usage snippet và helper commands trực tiếp vào repo (ví dụ: `scripts/enable-ssh.sh` hay một `bootstrap` helper). Mình sẽ sửa `auto-deploy.sh` để in rõ ràng public key trên stdout.
- (B) Hoặc mình mở rộng `scripts/deploy-to-vps.ps1` để hỗ trợ upload chỉ phần build (ví dụ `public/` hoặc `out/`) thay vì toàn bộ repo.

Chọn A hoặc B (hoặc cả hai) và mình sẽ tiếp tục thực hiện.

---

Hướng dẫn nhanh: dán public key vào GitHub (UI)

1. Vào repo của bạn trên GitHub.
2. Click `Settings` -> `Deploy keys` -> `Add deploy key`.
3. Điền `Title` (ví dụ: "VPS deploy (auto)") và dán nội dung public key (bắt đầu `ssh-ed25519 AAAA...`).
4. Nếu bạn chỉ cần server pull (không push), không tick `Allow write access`. Nếu bạn muốn server có quyền push, tick `Allow write access`.
5. Click `Add key`.

Sau khi dán key, quay lại VPS và chạy `./scripts/auto-deploy.sh ...` (nó sẽ thử git clone lại).