# tools/send-signed.ps1
# Sends a signed POST /tele/sendMessage to the local server using HMAC from .env.local
# Usage: pwsh -NoProfile -File .\tools\send-signed.ps1 -Message 'Hello'
param(
  [Parameter(Mandatory=$false)] [string] $Message = 'Hello from send-signed',
  [Parameter(Mandatory=$false)] [string] $EnvPath = '.env.local',
  [Parameter(Mandatory=$false)] [switch] $Quiet,
  [Parameter(Mandatory=$false)] [string] $OutputFile
)

# Resolve repo root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path -Path (Join-Path $scriptDir '..')
Set-Location $repoRoot

# Load env file simple parser
$envFile = Join-Path $repoRoot $EnvPath
if (-Not (Test-Path $envFile)) { Write-Error "Env file $envFile not found"; exit 2 }
$env = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $parts = $line -split '=',2
    if ($parts.Count -eq 2) { $env[$parts[0].Trim()] = $parts[1].Trim().Trim('"') }
  }
}

$hmacKey = $env['HMAC_KEY']  # expected
$port = $env['PORT'] ? $env['PORT'] : '3002'
if (-not $hmacKey) { Write-Warning 'HMAC_KEY not found in env file. Using empty key.' }

$uri = "http://localhost:${port}/tele/sendMessage"
$path = '/tele/sendMessage'
$method = 'POST'
$body = ConvertTo-Json @{ message = $Message } -Depth 4
$ts = [int]((Get-Date).ToUniversalTime() - [DateTime]'1970-01-01').TotalSeconds
$nonce = [guid]::NewGuid().ToString('N')
$base = "$method`n$path`n$ts`n$nonce`n$body"

# Compute HMAC-SHA256 hex
$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($hmacKey)
# Construct HMACSHA256 in a way compatible with different PowerShell/.NET versions
try {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($keyBytes)
} catch {
  # Fallback: create without key then assign
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = $keyBytes
}
$sigBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($base))
$sigHex = ($sigBytes | ForEach-Object { $_.ToString('x2') }) -join ''
$signatureHeader = "v1=$sigHex"

$headers = @{ 'X-Signature' = $signatureHeader; 'X-Timestamp' = $ts; 'X-Nonce' = $nonce; 'Content-Type' = 'application/json' }

# Helper: quiet-aware logging
function Write-Log([string]$s, [string]$color = 'White') {
  if (-not $Quiet) { Write-Host $s -ForegroundColor $color }
}

Write-Log "Attempting POST to $uri" 'Cyan'
Write-Log "Headers: X-Timestamp=$ts X-Nonce=$nonce X-Signature=v1=<redacted>" 'DarkGray'

# Try the configured port, and if the request fails (connection error or 5xx), try next ports up to +3
$maxTries = 4
$basePort = [int]$port
for ($i = 0; $i -lt $maxTries; $i++) {
  $tryPort = $basePort + $i
  $tryUri = $uri -replace ":$basePort/", ":$tryPort/"
  try {
    # Use Invoke-WebRequest to capture status code and raw content
    $resp = Invoke-WebRequest -Uri $tryUri -Method Post -Body $body -Headers $headers -ContentType 'application/json' -ErrorAction Stop
    $status = [int]$resp.StatusCode
    $content = $resp.Content

    if ($Quiet) {
      if ($OutputFile) {
        $content | Out-File -FilePath $OutputFile -Encoding utf8
      } else {
        Write-Output $content
      }
    } else {
      Write-Host "Request returned HTTP $status"
      Write-Host "Response body:`n$content"
    }

    if ($status -ge 200 -and $status -lt 300) {
      exit 0
    } else {
      Write-Log "Non-success HTTP status: $status" 'Yellow'
      exit 4
    }
    break
  } catch {
    Write-Log "Request to port $tryPort failed: $($_.Exception.Message)" 'Yellow'
    if ($i -eq ($maxTries - 1)) {
      Write-Log 'All attempts failed.' 'Red'
      if ($_.Exception.Response) { $_.Exception.Response | Format-List * -Force }
      exit 3
    } else {
      Write-Log "Trying port $($tryPort + 1)..." 'DarkGray'
    }
  }
}
