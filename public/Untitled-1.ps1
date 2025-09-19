Invoke-RestMethod -Method POST http://127.0.0.1:4002/api/telegram/config `
  -Body (@{ token='TOKEN_MOI'; chatId='CHAT_ID_DUNG'; allowRawSensitive=$true } | ConvertTo-Json) `
  -ContentType 'application/json'
  