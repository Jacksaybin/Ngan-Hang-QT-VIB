<#
Set-env.ps1
Interactive PowerShell script to set API and Telegram values into .env safely.
It will replace existing keys or append them.
It can optionally run a test send to Telegram using node script.
#>
Param()

Function Read-SecureInput($prompt) {
  $secure = Read-Host -AsSecureString "$prompt (input will be hidden)"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host "This script will update the project's .env file with the values you provide."
Write-Host "Important: do NOT commit secrets (.env) to source control. .env is currently in .gitignore."

$envFile = Join-Path -Path (Get-Location) -ChildPath ".env"
if (-not (Test-Path $envFile)) { New-Item -Path $envFile -ItemType File -Force | Out-Null }

$apiUrl = Read-Host 'API_URL (leave empty to keep current)'
$apiKey = Read-Host 'API_KEY (leave empty to keep current)'
$telegramToken = Read-SecureInput 'TELEGRAM_BOT_TOKEN (hidden)'
$telegramChat = Read-Host 'TELEGRAM_CHAT_ID (leave empty to keep current)'

function Set-Or-Update([string]$path, [string]$key, [string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return }
  $content = Get-Content $path -Raw
  $pattern = "^$key=.*$"
  if ($content -match "(?m)^$key=") {
    $new = ($content -replace "(?m)^$key=.*", "$key=$value")
  } else {
    $new = $content.TrimEnd() + "`n$key=$value`n"
  }
  Set-Content -Path $path -Value $new -Force
}

Set-Or-Update -path $envFile -key 'API_URL' -value $apiUrl
Set-Or-Update -path $envFile -key 'API_KEY' -value $apiKey
Set-Or-Update -path $envFile -key 'TELEGRAM_BOT_TOKEN' -value $telegramToken
Set-Or-Update -path $envFile -key 'TELEGRAM_CHAT_ID' -value $telegramChat

Write-Host "Updated $envFile"

$runTest = Read-Host 'Do you want to send a test Telegram message now? (y/N)'
if ($runTest -match '^[Yy]') {
  Write-Host "Running test-telegram.js (requires node)..."
  & node scripts/test-telegram.js
}
