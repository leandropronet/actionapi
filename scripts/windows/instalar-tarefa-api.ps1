# Requer PowerShell executado como Administrador para iniciar na inicialização
# do Windows (SYSTEM). Sem elevação, instala para iniciar no logon do usuário
# atual (mesma limitação da tarefa ActionAPI-ETL).
[CmdletBinding()]
param(
    [string]$TaskName = "ActionAPI-API"
)

$ErrorActionPreference = "Stop"
$Runner = Join-Path $PSScriptRoot "ActionAPI-API.ps1"
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
    -Description "ActionAPI - servidor Fastify (porta configurada em .env)" `
    -Force

Start-ScheduledTask -TaskName $TaskName
Write-Host "Tarefa $TaskName instalada e iniciada."
