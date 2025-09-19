<#
  PowerShell cleanup script - deletes common junk files in the project
  Usage: .\scripts\cleanup.ps1 [-WhatIf]
#>
Param(
  [switch]$WhatIf,
  [string[]]$ExcludeDirs = @()
)

# Default excludes (common large or user-uploaded dirs)
$defaultExcludes = @('public/uploads','uploads','node_modules','.git','.github')

# Read .cleanupignore if exists (one pattern per line, can be relative path)
if (Test-Path .cleanupignore) {
  $fileExcludes = Get-Content .cleanupignore | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
  if ($fileExcludes) { $ExcludeDirs += $fileExcludes }
}

$ExcludeDirs += $defaultExcludes
$ExcludeDirs = $ExcludeDirs | Select-Object -Unique

$patterns = @('*.log','*.err','*.tmp','*.bak','*.pid')

Write-Host "Scanning for junk files..."
$repoRoot = (Get-Location).ProviderPath

foreach ($p in $patterns) {
  Get-ChildItem -Path $repoRoot -Filter $p -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $file = $_.FullName
    # check exclude dirs
    $isExcluded = $false
    foreach ($ex in $ExcludeDirs) {
      if ([string]::IsNullOrEmpty($ex)) { continue }
      # normalize and check contains
      $normalized = $ex -replace '/','\\'
      if ($file -like "*$normalized*") { $isExcluded = $true; break }
    }

    if ($isExcluded) {
      Write-Host "Skipping excluded: $file"
      continue
    }

    if ($WhatIf) { Write-Host "Would remove: $file" }
    else { Remove-Item -LiteralPath $file -Force; Write-Host "Removed: $file" }
  }
}

Write-Host "Done."
