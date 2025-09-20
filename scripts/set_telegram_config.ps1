$payload = @{ token = 'REPLACE_ME_TELEGRAM_BOT_TOKEN'; chatId = 'REPLACE_ME_TELEGRAM_CHAT_ID'; allowRawSensitive = $true }
$body = $payload | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:4002/api/telegram/config' -Body $body -ContentType 'application/json'
Write-Host 'Done'