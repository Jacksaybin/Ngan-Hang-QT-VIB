<#
.SYNOPSIS
Deploy the current git HEAD to a remote VPS via SSH and restart the app with pm2.

.DESCRIPTION
This script creates a tar archive of the current Git HEAD (or falls back to a directory tar), copies it to the remote server using scp, extracts it to the target directory, runs `npm install --production` on the server and attempts to start/restart the app using pm2.

.PARAMETER Host
Remote host or IP (required).

.PARAMETER User
Remote user (default: deploy).

.PARAMETER Port
SSH port (default: 22).

.PARAMETER KeyPath
Path to private SSH key (default: $env:USERPROFILE\.ssh\id_ed25519).

.PARAMETER RemotePath
Destination path on the remote server (default: /var/www/app).

.PARAMETER UseSudo
If set, extraction and service commands on remote will use sudo.

.PARAMETER KeepArchive
If set, do not delete the temporary archive on the remote after extraction.

.EXAMPLE
PS> .\scripts\deploy-to-vps.ps1 -Host 203.0.113.45 -User deploy -KeyPath $env:USERPROFILE\.ssh\id_ed25519 -RemotePath /var/www/vib
#>
param(
    [Parameter(Mandatory=$true)] [string] $Host,
    [string] $User = 'deploy',
    [int] $Port = 22,
    [string] $KeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
    [string] $RemotePath = '/var/www/app',
    [switch] $UseSudo,
    [switch] $KeepArchive
)

set -e

function Write-ErrAndExit($msg){ Write-Host $msg -ForegroundColor Red; exit 1 }

# Validate SSH key
if (-not (Test-Path -Path $KeyPath)){
    Write-ErrAndExit "SSH key not found at '$KeyPath'. Provide a valid path with -KeyPath or generate a key and add to remote authorized_keys."
}

# Ensure scp/ssh available
if (-not (Get-Command scp -ErrorAction SilentlyContinue)){
    Write-Host "Warning: 'scp' not found in PATH. Ensure OpenSSH is installed and available." -ForegroundColor Yellow
}

# Create archive of current git HEAD if possible
$archiveName = "deploy-$(Get-Date -Format yyyyMMdd-HHmmss).tar"
$archivePath = Join-Path -Path $PWD -ChildPath $archiveName

if (Get-Command git -ErrorAction SilentlyContinue){
    Write-Host "Creating archive of current Git HEAD -> $archiveName"
    $gitArchiveCmd = "git archive --format=tar --output='$archivePath' HEAD"
    $rc = & git archive --format=tar --output=$archivePath HEAD
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archivePath)){
        Write-Host "git archive failed, will try fallback tar of working tree" -ForegroundColor Yellow
        Remove-Item -Force -ErrorAction SilentlyContinue $archivePath
    }
}

# Fallback: tar whole directory excluding node_modules and .git
if (-not (Test-Path $archivePath)){
    Write-Host "Creating fallback archive of working tree (excludes node_modules and .git) -> $archiveName"
    $exclude = @('.git','node_modules')
    # Windows 'tar' supports --exclude
    $excludeArgs = $exclude | ForEach-Object { "--exclude=`"$_`"" } | Out-String
    $tarCmd = "tar -cf $archivePath $($excludeArgs.Trim()) ."
    # Use built-in tar
    try{
        & tar -cf $archivePath --exclude='.git' --exclude='node_modules' .
    } catch {
        Write-ErrAndExit "Failed creating archive. Ensure 'tar' is available or run from WSL." 
    }
}

if (-not (Test-Path $archivePath)){
    Write-ErrAndExit "Failed to create deployment archive."
}

# Copy archive to remote
$remoteTmp = "/tmp/$archiveName"
$scpCmd = "scp -P $Port -i `"$KeyPath`" `"$archivePath`" $User@$Host:`"$remoteTmp`""
Write-Host "Uploading $archiveName to $User@$Host:$remoteTmp"
$scpArgs = @('-P',$Port,'-i',$KeyPath,$archivePath,"$User@$Host:$remoteTmp")
$proc = Start-Process -FilePath scp -ArgumentList $scpArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0){
    Write-ErrAndExit "scp failed with exit code $($proc.ExitCode)."
}

# Remote commands: extract, install, restart
$extractCmd = "mkdir -p $RemotePath && tar -xf $remoteTmp -C $RemotePath && chown -R $User:$User $RemotePath"
if ($UseSudo){ $extractCmd = "sudo sh -c '$extractCmd'" }

$installCmd = "cd $RemotePath && npm install --production --no-audit --no-fund"
if ($UseSudo){ $installCmd = "sudo sh -c 'cd $RemotePath && npm install --production --no-audit --no-fund'" }

# Try pm2 restart or start
$pm2Cmd = "cd $RemotePath && (pm2 restart ecosystem.config.js --env production || pm2 start ecosystem.config.js --env production || pm2 start server.js --name vib-server) && pm2 save"
if ($UseSudo){ $pm2Cmd = "sudo sh -c '$pm2Cmd'" }

$cleanupRemote = "if [ -f $remoteTmp ]; then rm -f $remoteTmp; fi"
if ($KeepArchive){ $cleanupRemote = "echo 'Keeping remote archive $remoteTmp'" }
if ($UseSudo){ $cleanupRemote = "sudo sh -c '$cleanupRemote'" }

$sshBaseArgs = @('-p',$Port,'-i',$KeyPath,'-o','StrictHostKeyChecking=no')

# Run remote extract
Write-Host "Extracting archive on remote and installing dependencies..."
$sshArgs = $sshBaseArgs + @("$User@$Host", $extractCmd)
$proc = Start-Process -FilePath ssh -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0){ Write-ErrAndExit "Remote extract command failed (exit $($proc.ExitCode))." }

# Install
$sshArgs = $sshBaseArgs + @("$User@$Host", $installCmd)
$proc = Start-Process -FilePath ssh -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0){ Write-Host "npm install failed on remote (exit $($proc.ExitCode)). Continuing to attempt pm2 start" -ForegroundColor Yellow }

# PM2
$sshArgs = $sshBaseArgs + @("$User@$Host", $pm2Cmd)
$proc = Start-Process -FilePath ssh -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0){ Write-Host "pm2 start/restart failed on remote (exit $($proc.ExitCode)). You may need to check logs on the server." -ForegroundColor Yellow }

# Cleanup remote archive
$sshArgs = $sshBaseArgs + @("$User@$Host", $cleanupRemote)
Start-Process -FilePath ssh -ArgumentList $sshArgs -NoNewWindow -Wait -PassThru | Out-Null

# Remove local archive
try{ Remove-Item -Force $archivePath } catch {}

Write-Host "Deployment finished. Check remote app status: ssh -i $KeyPath $User@$Host 'pm2 ls' and test your site/service." -ForegroundColor Green
