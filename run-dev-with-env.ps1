# run-dev-with-env.ps1
# Helper to run dev server with environment variables loaded from .env.local (Windows PowerShell)
# Usage: edit .env.local (or let script copy env.example -> .env.local) then run this script in PowerShell:
#    pwsh -NoProfile -ExecutionPolicy Bypass -File .\run-dev-with-env.ps1

param()

$repoRoot = $null
# Determine script directory robustly across PowerShell versions and invocation styles
if ($PSCommandPath) {
    $repoRoot = Split-Path -Parent $PSCommandPath
} elseif ($PSScriptRoot) {
    $repoRoot = $PSScriptRoot
} elseif ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
    $repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    # Fall back to current working directory
    $repoRoot = (Get-Location).ProviderPath
}

# Try to resolve path to a full absolute Windows path; if Resolve-Path fails, continue with the raw value
try {
    $rp = Resolve-Path -Path $repoRoot -ErrorAction Stop
    $repoRoot = $rp.Path
} catch {
    # keep $repoRoot as-is
}

# Ensure the path exists before changing location
if (Test-Path -Path $repoRoot) {
    Set-Location -Path $repoRoot
} else {
    Write-Warning "Repository root path '$repoRoot' not found. Using current location instead."
}

$envFile = Join-Path $repoRoot '.env.local'
$exampleFile = Join-Path $repoRoot 'env.example'

if (-Not (Test-Path $envFile)) {
    if (Test-Path $exampleFile) {
        Write-Host "No .env.local found. Copying env.example -> .env.local (please edit secrets before continuing)..." -ForegroundColor Yellow
        Copy-Item -Path $exampleFile -Destination $envFile -Force
        Write-Host "Created .env.local from env.example at $envFile" -ForegroundColor Green
        Write-Host "Open and edit .env.local to add BOT_TOKEN, CHAT_ID, HMAC_KEY, and set REQUIRE_HMAC=1 if needed." -ForegroundColor Cyan
        Write-Host "Press Enter to continue (or Ctrl+C to cancel) after editing .env.local..."
        Read-Host | Out-Null
    } else {
        Write-Error "env.example not found; please create .env.local with required variables and rerun." -ForegroundColor Red
        exit 2
    }
}

# Load .env.local (simple KEY=VALUE parser)
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
        $parts = $line -split '=',2
        if ($parts.Count -eq 2) {
            $k = $parts[0].Trim()
            $v = $parts[1].Trim()
            # Remove optional surrounding quotes
            if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Trim('"') }
            if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Trim("'") }
            Write-Host "Setting env var: $k" -ForegroundColor DarkGreen
            Set-Item -Path Env:\$k -Value $v
        }
    }
}

# Default PORT if not set
if (-not $env:PORT) { $env:PORT = '3002'; Write-Host "PORT not set, using $($env:PORT)" -ForegroundColor Yellow }

Write-Host "Starting dev server (npm run dev) with environment loaded..." -ForegroundColor Cyan
npm run dev
