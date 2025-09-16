<#
tools/push-to-github.ps1
Usage: pwsh .\tools\push-to-github.ps1 [-RemoteUrl <string>] [-Branch <string>]
#>

param(
    [string] $RemoteUrl = '',
    [string] $Branch = 'main'
)

# Determine repository root. Prefer the script's parent directory so the script
# can be executed from any working directory (e.g. CI or user home).
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
    # Fallback when $PSScriptRoot is not set (rare).
    $scriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
}

# Assume script lives in repo/tools so the repo root is the parent of $scriptDir.
try {
    $repoRoot = Resolve-Path -Path (Join-Path $scriptDir '..')
} catch {
    # As a last resort, use the current working directory.
    $repoRoot = Resolve-Path -Path .
}

Set-Location $repoRoot

if (-not (Test-Path .git)) {
    Write-Host "No git repo found. Initializing..."
    git init
}

if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
    $RemoteUrl = Read-Host 'Enter Git remote URL (git@... or https://...)'
}

if (-not (git remote | Select-String '^origin$')) {
    git remote add origin $RemoteUrl
} else {
    Write-Host "Remote 'origin' exists; setting URL to $RemoteUrl"
    git remote set-url origin $RemoteUrl
}

git add -A
try {
    git commit -m 'chore: initial commit - prepare repo for GitHub'
} catch {
    Write-Host "Commit may have failed (no changes) - continuing"
}

$current = (git branch --show-current 2>$null)
if (-not $current) {
    git checkout -b $Branch
} elseif ($current -ne $Branch) {
    git checkout -b $Branch
}

Write-Host "Pushing to origin/$Branch..."
git push -u origin $Branch

Write-Host "Push complete."
