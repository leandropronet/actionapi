$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EtlDir = Join-Path $Root "packages\etl"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "etl-service.log"
$ErrorLogFile = Join-Path $LogDir "etl-service.error.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $EtlDir

while ($true) {
    $started = Get-Date -Format o
    "[$started] iniciando ActionAPI ETL" | Out-File -FilePath $LogFile -Append -Encoding utf8
    try {
        $Command = 'node "src/index.js" >> "' + $LogFile + '" 2>> "' + $ErrorLogFile + '"'
        $Process = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList "/d", "/s", "/c", $Command `
            -WorkingDirectory $EtlDir `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
        if ($Process.ExitCode -ne 0) {
            throw "node saiu com código $($Process.ExitCode)"
        }
    }
    catch {
        "[$(Get-Date -Format o)] erro: $($_.Exception.Message)" |
            Out-File -FilePath $LogFile -Append -Encoding utf8
    }
    Start-Sleep -Seconds 15
}
