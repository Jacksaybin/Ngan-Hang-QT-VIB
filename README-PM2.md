Hướng dẫn PM2 trên Windows (PowerShell) — tiếng Việt

Tổng quan nhanh

- Project này đã có `ecosystem.config.js` để chạy server bằng PM2.

1. Cài PM2 (nếu chưa):

```powershell
npm install -g pm2
```

2. Khởi chạy ứng dụng bằng file ecosystem (thư mục dự án):

```powershell
cd 'C:\Users\truon\VIB'
npm run pm2:start
```

3. Kiểm tra trạng thái / logs:pm2 ls

```powershell
npm run pm2:list
pm2 logs vib-server --lines 200
```

4. Tự động phục hồi PM2 sau khởi động (hai lựa chọn)

- A. Per-user (chạy khi user đăng nhập)

  - Đây là cách đơn giản, không cần quyền Administrator: script `scripts/setup-pm2-resurrect-task.ps1` đã tạo một scheduled task để chạy `pm2 resurrect` khi user đăng nhập.
  - Chạy (không cần admin):
    ```powershell
    cd 'C:\Users\truon\VIB'
    .\scripts\setup-pm2-resurrect-task.ps1 -Force
    ```

- B. System boot (chạy trước khi user đăng nhập) — yêu cầu Administrator
  - Script hỗ trợ tuỳ chọn `-SystemBoot` để tạo task chạy dưới tài khoản `SYSTEM` khi máy khởi động.
  - Vì `schtasks` rất nhạy với quoting, script sẽ cố tạo một file wrapper `.bat` rồi trỏ `/TR` tới wrapper.
  - Để tạo task SYSTEM (chạy trong cửa sổ PowerShell mở bằng Run as Administrator):
    ```powershell
    cd 'C:\Users\truon\VIB'
    .\scripts\setup-pm2-resurrect-task.ps1 -SystemBoot -Force
    ```
  - Nếu script không thể tự tạo wrapper (ví dụ do quyền), bạn có thể tạo wrapper thủ công và chạy lệnh sau trong Admin PowerShell:
    ```powershell
    schtasks /Create /SC ONSTART /TN "PM2 Resurrect" /TR "C:\ProgramData\pm2-resurrect-wrapper.bat" /RL HIGHEST /F /RU SYSTEM
    ```

Chú ý về `pm2` và account SYSTEM

- Nếu `pm2` cài ở phạm vi user (mặc định `C:\Users\<you>\AppData\Roaming\npm\pm2.cmd`), task chạy dưới SYSTEM có thể không tìm thấy `pm2` hoặc môi trường cần thiết. Vì vậy:
  - Tốt nhất là cài `pm2` cho toàn hệ thống (global) hoặc
  - Dùng per-user scheduled task (chỉ chạy khi user đăng nhập), hoặc
  - Sử dụng `nssm` để tạo Windows Service chạy Node/PM2 dưới SYSTEM.

Kiểm tra sau khi tạo task

- Kiểm tra task:

```powershell
Get-ScheduledTask -TaskName 'PM2 Resurrect' | Format-List *
```

- Chạy thử task và kiểm tra kết quả:

```powershell
Start-ScheduledTask -TaskName 'PM2 Resurrect'
Start-Sleep -Seconds 2
Get-ScheduledTaskInfo -TaskName 'PM2 Resurrect' | Select-Object LastRunTime, LastTaskResult | Format-List
```

- Kiểm tra PM2 / app:

```powershell
pm2 ls
curl -sS http://127.0.0.1:4000/health -w "`nHTTP_STATUS:%{http_code}`n"
```

Phương án thay thế: NSSM (recommended for true service behavior)

- NSSM (Non-Sucking Service Manager) có thể dùng để chạy `node`/`pm2` như một Windows Service dưới SYSTEM. Lợi ích: service có thể chạy trước khi user đăng nhập và không phụ thuộc vào profile user.
- Tóm tắt steps (có thể thêm helper script nếu bạn muốn):
  1. Tải `nssm` từ trang chính thức và giải nén.
  2. Tạo service: `nssm install vib-server "C:\Program Files\nodejs\node.exe" "C:\Users\truon\VIB\server.js"` (với đường dẫn phù hợp)
  3. Start service: `nssm start vib-server` hoặc `Start-Service vib-server`

Ghi chú cuối

- Nếu bạn muốn, tôi sẽ:
  - A) cập nhật script để tự động tạo wrapper trong `C:\ProgramData` khi chạy elevated; hoặc
  - B) thêm helper `nssm` (script) để đăng ký service; hoặc
  - C) giúp bạn thử nghiệm sau reboot và ghi nhận kết quả.
