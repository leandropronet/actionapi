[CmdletBinding()]
param(
    [ValidateSet("up", "down", "restart", "status", "logs", "build")]
    [string]$Action = "up"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$ComposeEnv = Join-Path $Root ".env.docker"

& (Join-Path $PSScriptRoot "preparar-env-compose.ps1") | Out-Host

function Invoke-Compose {
    param([string[]]$Arguments)

    $standalone = Get-Command docker-compose -ErrorAction SilentlyContinue
    if ($standalone) {
        & $standalone.Source --env-file $ComposeEnv @Arguments
        if ($LASTEXITCODE -ne 0) { throw "docker-compose falhou." }
        return
    }

    $onPremiseCompose = "C:\OnPremise\docker-compose.exe"
    if (Test-Path -LiteralPath $onPremiseCompose) {
        & $onPremiseCompose --env-file $ComposeEnv @Arguments
        if ($LASTEXITCODE -ne 0) { throw "C:\OnPremise\docker-compose.exe falhou." }
        return
    }

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & docker compose version *> $null
    $pluginAvailable = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousPreference
    if ($pluginAvailable) {
        & docker compose --env-file $ComposeEnv @Arguments
        if ($LASTEXITCODE -ne 0) { throw "docker compose falhou." }
        return
    }

    throw "Docker Compose não está instalado nem disponível em C:\OnPremise."
}

function Assert-LinuxDocker {
    $serverType = & docker info --format "{{.OSType}}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Sem acesso ao daemon Docker. Execute elevado ou use o serviço Windows ActionAPI-ETL."
    }
    if ($serverType.Trim() -ne "linux") {
        throw @"
O daemon atual executa contêineres Windows. Este Compose usa imagens Linux
(PostgreSQL Alpine e Node Alpine) e não pode ser executado nesse engine.
Mantenha a tarefa Windows ActionAPI-ETL ou use um host Docker Linux separado.
"@
    }
}

switch ($Action) {
    "up"      { Assert-LinuxDocker; Invoke-Compose @("up", "-d", "--build") }
    "down"    { Invoke-Compose @("down") }
    "restart" { Invoke-Compose @("restart", "etl-service", "actionapi") }
    "status"  { Invoke-Compose @("ps") }
    "logs"    { Invoke-Compose @("logs", "-f", "--tail", "200", "etl-service", "actionapi") }
    "build"   { Assert-LinuxDocker; Invoke-Compose @("build", "--pull") }
}
