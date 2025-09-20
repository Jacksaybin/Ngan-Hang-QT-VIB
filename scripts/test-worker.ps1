<#
PowerShell test script to POST to the Worker `/api/field-update` endpoint.
Usage examples:
  # Text-only
  .\scripts\test-worker.ps1 -WorkerUrl "https://your-worker.workers.dev"

  # With tiny image
  .\scripts\test-worker.ps1 -WorkerUrl "https://your-worker.workers.dev" -WithImage

Options:
  -WorkerUrl   Required. Full URL of your worker (no trailing slash). Example: https://abcxyz.workers.dev
  -SessionId   Optional. Defaults to 'test-ps'
  -WithImage   Switch. If present, the script adds a tiny 1x1 PNG data URL to `images`.
  -Verbose     Show more details.

Note: This script does NOT include the Telegram token or chat id. The Worker will read secrets you set with `wrangler secret put`.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$WorkerUrl,

    [string]$SessionId = 'test-ps',

    [switch]$WithImage
)

function Show-Json {
    param($obj)
    $obj | ConvertTo-Json -Depth 5
}

$payload = @{
    sessionId = $SessionId
    fullName = 'Nguyen Van PS'
    phone = '0900000000'
    page = 1
}

if ($WithImage) {
    $tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQG8sZ4AAAAASUVORK5CYII='
    $payload.images = @($tiny)
}

$body = $payload | ConvertTo-Json -Compress

Write-Host "Posting to $WorkerUrl/api/field-update ..."
try {
    $resp = Invoke-RestMethod -Uri "$WorkerUrl/api/field-update" -Method Post -ContentType 'application/json' -Body $body -ErrorAction Stop
    Write-Host "Response:`n"
    Show-Json $resp
} catch {
    Write-Host "Request failed:`n$($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        try { $text = $_.Exception.Response | Select-Object -ExpandProperty Content -ErrorAction SilentlyContinue; Write-Host "Response body:`n$text" } catch {}
    }
}
