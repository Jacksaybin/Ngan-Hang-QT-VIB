# PowerShell script to configure the running local server with a Telegram bot token and chatId,
# validate the token with getMe, optionally list getUpdates to discover chatIds,
# call the server's /api/telegram/config, /api/telegram/test, and (optionally) /api/telegram/resend.
# Usage: pwsh .\scripts\config-telegram.ps1

function Read-SecureToken {
    Write-Host "Paste your Telegram Bot token (format: 123456:ABC-DEF...)", -ForegroundColor Cyan
    $secure = Read-Host -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    return $token
}

try {
    $token = Read-SecureToken
    if (-not $token -or $token.Trim().Length -lt 10) { Write-Error "Token có vẻ không hợp lệ."; exit 1 }

    Write-Host "Kiểm tra token với Telegram (getMe)..." -ForegroundColor Yellow
    try {
        $gm = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe" -Method Get -ErrorAction Stop
    } catch {
        Write-Error "Lỗi khi gọi getMe: $($_.Exception.Message)"
        Write-Host "URL thử: https://api.telegram.org/bot$token/getMe" -ForegroundColor DarkYellow
        exit 2
    }

    if ($gm.ok) {
        Write-Host "✅ Token hợp lệ. Bot: $($gm.result.username) (id: $($gm.result.id))" -ForegroundColor Green
    } else {
        Write-Error "getMe trả về không ok: $($gm | ConvertTo-Json -Depth 3)"; exit 3
    }

    # Ask for chatId or try to discover via getUpdates
    $chatId = Read-Host "Nhập chatId để cấu hình server (để trống để lấy từ getUpdates)"
    if (-not $chatId) {
        Write-Host "Gọi getUpdates để liệt kê các chat hiện có..." -ForegroundColor Yellow
        try {
            $upd = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates" -Method Get -ErrorAction Stop
        } catch {
            Write-Error "Lỗi khi gọi getUpdates: $($_.Exception.Message)"; $upd = $null
        }

        if ($upd -and $upd.result -and $upd.result.Count -gt 0) {
            $chats = @{}
            foreach ($u in $upd.result) {
                if ($u.message) {
                    $id = $u.message.chat.id
                    $title = $u.message.chat.title
                    $user = $u.message.from.username
                    if (-not $chats.ContainsKey($id)) { $chats[$id] = @() }
                    $chats[$id] += @{ when = $u.message.date; text = $u.message.text; from = $u.message.from.username }
                }
            }
            if ($chats.Keys.Count -eq 0) { Write-Host "Không tìm thấy chat nào trong getUpdates." }
            else {
                Write-Host "Các chat tìm thấy:" -ForegroundColor Cyan
                foreach ($k in $chats.Keys) {
                    Write-Host "- chatId: $k, messages: $($chats[$k].Count)" -ForegroundColor Gray
                }
                $chatId = Read-Host "Chọn chatId từ danh sách trên (dán số)"
            }
        } else {
            Write-Host "Không có kết quả getUpdates. Hãy gửi 1 tin tới bot từ tài khoản đích, hoặc nhập chatId trực tiếp." -ForegroundColor Yellow
            $chatId = Read-Host "Nếu bạn có chatId hãy dán vào đây (hoặc enter để hủy)"
            if (-not $chatId) { Write-Host "Không có chatId. Dừng."; exit 4 }
        }
    }

    Write-Host "Cấu hình server với token và chatId..." -ForegroundColor Yellow
    $cfgBody = @{ token = $token; chatId = $chatId } | ConvertTo-Json
    try {
        $cfgResp = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/telegram/config" -Method Post -ContentType 'application/json' -Body $cfgBody -ErrorAction Stop
        Write-Host "Server response: $($cfgResp | ConvertTo-Json -Depth 4)" -ForegroundColor Green
    } catch {
        Write-Error "Lỗi khi gọi server /api/telegram/config: $($_.Exception.Message)"; exit 5
    }

    Write-Host "Chạy chẩn đoán server (/api/telegram/diagnose)..." -ForegroundColor Yellow
    try { $diag = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/telegram/diagnose" -Method Get -ErrorAction Stop } catch { Write-Error "Lỗi khi gọi /diagnose: $($_.Exception.Message)"; $diag = $null }
    if ($diag) { Write-Host ($diag | ConvertTo-Json -Depth 8) }

    Write-Host "Gọi /api/telegram/test để gửi tin thử..." -ForegroundColor Yellow
    $testBody = @{ text = "Test gửi từ server lúc $(Get-Date)" } | ConvertTo-Json
    try {
        $testResp = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/telegram/test" -Method Post -ContentType 'application/json' -Body $testBody -ErrorAction Stop
        Write-Host "Test response: $($testResp | ConvertTo-Json -Depth 6)" -ForegroundColor Green
    } catch {
        Write-Error "Lỗi khi gọi /api/telegram/test: $($_.Exception.Message)"; exit 6
    }

    $doResend = Read-Host "Bạn có muốn gọi /api/telegram/resend để re-send các bản ghi đã lưu không? (y/N)"
    if ($doResend -and $doResend.ToLower().StartsWith('y')) {
        $lastN = Read-Host "Nhập số bản ghi muốn gửi lại (mặc định 10)"
        if (-not $lastN) { $lastN = 10 }
        $resendBody = @{ lastN = [int]$lastN } | ConvertTo-Json
        try {
            $resResp = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/telegram/resend" -Method Post -ContentType 'application/json' -Body $resendBody -ErrorAction Stop
            Write-Host "Resend response: $($resResp | ConvertTo-Json -Depth 8)" -ForegroundColor Green
        } catch {
            Write-Error "Lỗi khi gọi /api/telegram/resend: $($_.Exception.Message)"
        }
    }

    Write-Host "Hoàn tất." -ForegroundColor Cyan
} catch {
    Write-Error "Lỗi không mong muốn: $($_.Exception.Message)"
    exit 99
}