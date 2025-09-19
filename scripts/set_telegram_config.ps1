$payload = @{ token = '8308693844:AAEe8ULvEqsIbQ9OYEbnsVv9_ONgAH4iAl4'; chatId = '-1003080363425'; allowRawSensitive = $true }
$body = $payload | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:4002/api/telegram/config' -Body $body -ContentType 'application/json'
Write-Host 'Done'