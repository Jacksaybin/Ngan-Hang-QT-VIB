<#
prepare-deploy-clean.ps1
Tạo bản preview ZIP (deploy-preview.zip) chứa chỉ những file sẽ deploy lên VPS.
Chạy trong PowerShell 7+ (pwsh) trên Windows. Không xóa file gốc.
#>
param(
    [switch]$DryRun,
    [string]$OutName = "deploy-preview.zip"
)

Set-StrictMode -Version Latest
$RepoRoot = (Get-Location).Path
$TS = Get-Date -Format yyyyMMdd-HHmmss
$Tmp = Join-Path -Path $env:TEMP -ChildPath "deploy-preview-$TS"
if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
New-Item -ItemType Directory -Path $Tmp | Out-Null

# Preflight: ensure lib/telegram-queue.js exists in repository - fail early if missing
$requiredFile = Join-Path $RepoRoot 'lib\telegram-queue.js'
if (-not (Test-Path $requiredFile)) {
    Write-Error "Required file 'lib\\telegram-queue.js' not found in repository. Ensure the file exists before creating the deploy preview. Aborting."
    exit 1
}

# Patterns to exclude
$ExcludeDirs = @('.git','node_modules','coverage','.vscode','test','tests')
$ExcludeFiles = @('*.test.js','*.spec.js','*.test.ts','*.spec.ts','*.tar','*.tar.gz','deploy-*.tar*','.DS_Store')
# Root HTML demo files to exclude
$RootHtmlExclude = @('dang-xu-ly.html','huy-tam-khoa-the.html','mo-the-tin-dung.html','nang hm html.html','nang-han-muc.html','otp.html','otphtml1.html','sua-yeu-cau.html','yeu-cau-da-gui.html')

Write-Host "Creating preview copy in $Tmp (dry-run=$($DryRun.IsPresent))" -ForegroundColor Cyan

# Use robocopy for fast copy with excludes
$robocopyArgs = @(
    '"' + $RepoRoot + '"',
    '"' + $Tmp + '"',
    '/E',
    '/COPY:DAT',
    '/R:1',
    '/W:1',
    '/NFL','/NDL','/NJH','/NJS'
)

if ($ExcludeDirs.Count -gt 0) {
    $robocopyArgs += '/XD'
    $robocopyArgs += ($ExcludeDirs -join ' ')
}
if ($ExcludeFiles.Count -gt 0) {
    $robocopyArgs += '/XF'
    $robocopyArgs += ($ExcludeFiles -join ' ')
}

$cmd = "robocopy " + ($robocopyArgs -join ' ')
Write-Host "Running: $cmd"

if ($DryRun) {
    Write-Host "DRY RUN: Showing files that would be copied (first 500 lines):" -ForegroundColor Yellow
    & robocopy $robocopyArgs /L
    Write-Host "\nDRY RUN complete. No files changed." -ForegroundColor Green
    exit 0
}

# Run robocopy
$rc = & robocopy $robocopyArgs
if ($LASTEXITCODE -ge 8) {
    Write-Warning "Robocopy failed with exit code $LASTEXITCODE"
}

# Ensure lib/telegram-queue.js is present in the temp copy. Some complex exclude lists can accidentally
# omit private folders; copy explicitly from the repo if needed and fail early if missing.
$copiedLib = Join-Path $Tmp 'lib\telegram-queue.js'
if (-not (Test-Path $copiedLib)) {
    Write-Host "lib\\telegram-queue.js not found in temp copy; explicitly copying lib directory..." -ForegroundColor Yellow
    $repoLib = Join-Path $RepoRoot 'lib'
    if (Test-Path $repoLib) {
        Copy-Item -Path $repoLib -Destination (Join-Path $Tmp 'lib') -Recurse -Force
    } else {
        Write-Error "Repository does not contain 'lib' directory. Aborting."
        exit 1
    }
}

if (-not (Test-Path $copiedLib)) {
    Write-Error "After attempting to copy, 'lib\\telegram-queue.js' is still missing from the preview. Aborting."
    exit 1
}

# Remove root HTML demo files (except index.html)
foreach ($f in $RootHtmlExclude) {
    $path = Join-Path $Tmp $f
    if (Test-Path $path) { Remove-Item -Force $path }
}

# Now produce listing of files that will be included
Write-Host "Files to be included (first 500 lines):" -ForegroundColor Cyan
Get-ChildItem -Path $Tmp -Recurse -File | ForEach-Object { $_.FullName.Substring($Tmp.Length+1) } | Sort-Object | Select-Object -First 500 | ForEach-Object { Write-Host $_ }

# Create zip archive in repo root
$OutPath = Join-Path $RepoRoot $OutName
if (Test-Path $OutPath) { Remove-Item -Force $OutPath }
Write-Host "Creating archive $OutPath ..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $Tmp '*') -DestinationPath $OutPath -Force

Write-Host "Archive created: $OutPath" -ForegroundColor Green

# Clean temp
Remove-Item -Recurse -Force $Tmp

Write-Host "Done. You can upload $OutPath to VPS (e.g. scp -o IdentitiesOnly=yes -i C:\\Users\\truon\\.ssh\\id_ed25519_new $OutPath deploy@103.180.134.74:/tmp/)" -ForegroundColor Cyan

exit 0
