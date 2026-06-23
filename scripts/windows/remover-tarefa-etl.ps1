[CmdletBinding()]
param(
    [string]$TaskName = "ActionAPI-ETL"
)

$ErrorActionPreference = "Stop"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarefa $TaskName removida."
