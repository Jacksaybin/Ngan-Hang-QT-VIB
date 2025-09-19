<#
setup-pm2-resurrect-task.ps1
Creates a Scheduled Task that runs `pm2 resurrect` at user logon so PM2 restores processes.
Run as Administrator or an elevated PowerShell session if you want RunLevel Highest.
#>
param(
    [string]$TaskName = 'PM2 Resurrect',
    [switch]$Force,
    [switch]$SystemBoot
)

Write-Host "Creating scheduled task '$TaskName' to run 'pm2 resurrect' at logon..."

# Resolve cmd.exe path (safe) and use it to run the pm2 command via cmd /c
$cmdPath = (Get-Command cmd.exe -ErrorAction SilentlyContinue).Source
if (-not $cmdPath) { Write-Error 'Unable to locate cmd.exe on this system.'; exit 2 }

# Prefer the Windows wrapper 'pm2.cmd' which lives in the user's npm global folder (AppData\Roaming\npm)
$npmGlobal = Join-Path $env:APPDATA 'npm'
$pm2CmdPath = Join-Path $npmGlobal 'pm2.cmd'

if (Test-Path $pm2CmdPath) {
    Write-Host "Found pm2 wrapper at: $pm2CmdPath -> will use explicit command"
    # Call pm2.cmd directly (no need for cmd /c). Use cmd.exe to keep behaviour consistent with scheduled tasks.
    $action = New-ScheduledTaskAction -Execute $cmdPath -Argument "/c `"$pm2CmdPath`" resurrect"
} else {
    # Fallback to relying on PATH - still works if pm2 is installed and on PATH for the user
    $pm2Cmd = (Get-Command pm2 -ErrorAction SilentlyContinue)
    if (-not $pm2Cmd) {
        Write-Warning "'pm2' was not found in PATH for this session. The scheduled task will still be created but may fail to run unless pm2 is accessible on PATH. Consider installing pm2 globally or re-running this script after adjusting PATH."
    }
    $action = New-ScheduledTaskAction -Execute $cmdPath -Argument "/c pm2 resurrect"
}

$trigger = New-ScheduledTaskTrigger -AtLogOn

# Helper to detect whether the script runs elevated
function Test-IsAdmin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# If user requested a system-boot (run as SYSTEM at startup) task, prepare schtasks command
if ($SystemBoot) {
    # Build the command to run under schtasks. Prefer explicit pm2.cmd when available.
    if (Test-Path $pm2CmdPath) {
        $pm2Exec = "`"$pm2CmdPath`" resurrect"
    } else {
        $pm2Exec = "pm2 resurrect"
    }

    # Instead of passing a long quoted command to schtasks (which often fails due to nested quoting),
    # create a small wrapper batch file next to this script that runs the pm2 command, then point /TR to it.
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $wrapperName = 'pm2-resurrect-wrapper.bat'
    $wrapperPath = Join-Path $scriptDir $wrapperName

    if (Test-Path $pm2CmdPath) {
        $batchContent = "@echo off`r`n`"$pm2CmdPath`" resurrect"
    } else {
        # fallback: call pm2 from PATH
        $batchContent = "@echo off`r`npm resurrect"
        # Note: this fallback likely fails under SYSTEM if pm2 isn't on PATH; user should install pm2 globally or use per-user task.
    }

    # Write the wrapper file (overwrites if exists)
    try {
        Set-Content -Path $wrapperPath -Value $batchContent -Encoding ASCII -Force
        Write-Host "Created wrapper script: $wrapperPath"
    } catch {
        $err = $_
        Write-Warning ("Could not create wrapper file at {0}: {1}. The script will continue but schtasks command may still fail." -f $wrapperPath, $err)
    }

    # schtasks /TR expects a path to an executable or script. We'll pass the wrapper full path and ensure proper quoting.
    $schCmdQuoted = "`"$wrapperPath`""
    $schtasksCreate = "schtasks /Create /SC ONSTART /TN `"$TaskName`" /TR $schCmdQuoted /RL HIGHEST /F /RU SYSTEM"

    if (-not (Test-IsAdmin)) {
        Write-Warning "Registering a task to run as SYSTEM at boot requires Administrator privileges."
        Write-Host "Run the following command in an elevated (Admin) PowerShell or Command Prompt to create the task:"
        Write-Host "`n$schtasksCreate`n"
        Write-Host "Alternatively re-run this script from an elevated PowerShell session with the `-SystemBoot` switch to perform the registration automatically."
        exit 0
    }

    # Running elevated: remove existing task (if -Force) and create via schtasks as SYSTEM
    if ($Force) {
        # Try to delete existing task first (silently ignore failures)
        try { Start-Process -FilePath schtasks -ArgumentList "/Delete","/TN","$TaskName","/F" -NoNewWindow -Wait -ErrorAction SilentlyContinue } catch {}
    }

    Write-Host "Creating scheduled task '$TaskName' to run at system startup as SYSTEM..."
    $proc = Start-Process -FilePath schtasks -ArgumentList "/Create","/SC","ONSTART","/TN","$TaskName","/TR",$schCmdQuoted,"/RL","HIGHEST","/F","/RU","SYSTEM" -NoNewWindow -Wait -PassThru -ErrorAction Stop
    if ($proc.ExitCode -eq 0) {
        Write-Host "Scheduled task '$TaskName' registered successfully to run at system startup as SYSTEM."
        Write-Host "You can verify with: Get-ScheduledTask -TaskName '$TaskName' | Format-List *"
        exit 0
    } else {
        Write-Error "schtasks reported exit code $($proc.ExitCode). If this persists, run the following command in an elevated shell:`n`schtasks /Create /SC ONSTART /TN `"$TaskName`" /TR `"$schCmdQuoted`" /RL HIGHEST /F /RU SYSTEM"
        exit 3
    }
}

# If a task already exists and -Force is specified, remove it first
$exists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($exists -and $Force) {
    Write-Host "Task exists and -Force specified: removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    $exists = $null
}

if ($exists) {
    Write-Host "Task '$TaskName' already exists. Use -Force to replace it."
    exit 0
}

# Register the scheduled task for the current user.
# Using no -User avoids needing to pass password; task will run as the user who registers it.
try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -RunLevel Highest -Description 'Resurrect PM2 processes at user logon' -Force:$Force
    Write-Host "Scheduled task '$TaskName' registered successfully."
    Write-Host "Note: Ensure 'pm2' is on PATH for the user account. You can test by running 'pm2 resurrect' from a user PowerShell session."
} catch {
    Write-Error "Failed to register scheduled task: $_"
    exit 3
}

Write-Host "Done."