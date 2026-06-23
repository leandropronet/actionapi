[CmdletBinding()]
param(
    [string]$TaskName = "ActionAPI-API"
)

$ErrorActionPreference = "Stop"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarefa $TaskName removida."
