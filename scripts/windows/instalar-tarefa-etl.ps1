# Requer PowerShell executado como Administrador.
[CmdletBinding()]
param(
    [string]$TaskName = "ActionAPI-ETL"
)

$ErrorActionPreference = "Stop"
$Runner = Join-Path $PSScriptRoot "ActionAPI-ETL.ps1"
$PowerShell = (Get-Command powershell.exe).Source

$Action = New-ScheduledTaskAction `
    -Execute $PowerShell `
    -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Runner`""
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -StartWhenAvailable

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$PrincipalObject = New-Object Security.Principal.WindowsPrincipal($Identity)
$IsAdmin = $PrincipalObject.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if ($IsAdmin) {
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest
}
else {
    Write-Warning "Sem elevação: instalando para iniciar no logon do usuário atual."
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $Principal = New-ScheduledTaskPrincipal `
        -UserId $Identity.Name `
        -LogonType Interactive `
        -RunLevel Limited
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "ActionAPI ETL Oracle SiAGRI para PostgreSQL" `
    -Force

Start-ScheduledTask -TaskName $TaskName
Write-Host "Tarefa $TaskName instalada e iniciada."
