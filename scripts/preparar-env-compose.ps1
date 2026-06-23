[CmdletBinding()]
param(
    [string]$Source,
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $Root ".env" }
if (-not $Destination) { $Destination = Join-Path $Root ".env.docker" }

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Arquivo de origem não encontrado: $Source"
}

$Output = [Collections.Generic.List[string]]::new()
foreach ($Line in Get-Content -LiteralPath $Source) {
    if ($Line -match "^\s*$" -or $Line -match "^\s*#") {
        $Output.Add($Line)
        continue
    }
    if ($Line -notmatch "^([^=]+)=(.*)$") {
        $Output.Add($Line)
        continue
    }
    $Name = $Matches[1].Trim()
    $Value = $Matches[2]
    # Valores com aspas simples são literais no Compose e preservam $, ! e #.
    $Escaped = $Value.Replace("'", "\'")
    $Output.Add("$Name='$Escaped'")
}

[IO.File]::WriteAllLines(
    $Destination,
    $Output,
    [Text.UTF8Encoding]::new($false)
)
Write-Host "Arquivo Compose gerado: $Destination"
