$proj = 'C:\Users\truon\VIB'
Write-Output "Checking: $proj\deploy-preview.zip"
if (Test-Path (Join-Path $proj 'deploy-preview.zip')) {
    $f = Get-Item (Join-Path $proj 'deploy-preview.zip')
    Write-Output "FOUND_PROJECT_ROOT: $($f.FullName) | $($f.Length) bytes | Modified: $($f.LastWriteTime)"
} else {
    Write-Output "Not found in project root. Searching project recursively..."
    $found = Get-ChildItem -Path $proj -Recurse -Filter 'deploy-preview*.zip' -ErrorAction SilentlyContinue
    if ($found) {
        foreach ($i in $found) { Write-Output "FOUND_PROJECT_RECURSIVE: $($i.FullName) | $($i.Length) bytes | Modified: $($i.LastWriteTime)" }
    } else { Write-Output "No deploy-preview*.zip found recursively in project." }

    Write-Output "Searching Temp dir: $env:TEMP"
    $foundTemp = Get-ChildItem -Path $env:TEMP -Recurse -Filter 'deploy-preview*' -ErrorAction SilentlyContinue
    if ($foundTemp) { foreach ($i in $foundTemp) { Write-Output "FOUND_TEMP: $($i.FullName) | $($i.Length) bytes | Modified: $($i.LastWriteTime)" } }
    else { Write-Output "No deploy-preview* entries found in TEMP." }

    $foundTempZip = Get-ChildItem -Path $env:TEMP -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*deploy-preview*' }
    if ($foundTempZip) { foreach ($i in $foundTempZip) { Write-Output "FOUND_TEMP_ZIP: $($i.FullName) | $($i.Length) bytes | Modified: $($i.LastWriteTime)" } }
    else { Write-Output "No deploy-preview*.zip found in TEMP." }
}
