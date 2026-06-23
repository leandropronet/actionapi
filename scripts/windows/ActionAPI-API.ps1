$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ApiDir = Join-Path $Root "packages\api"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "api-service.log"
$ErrorLogFile = Join-Path $LogDir "api-service.error.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $ApiDir

while ($true) {
    $started = Get-Date -Format o
    "[$started] iniciando ActionAPI" | Out-File -FilePath $LogFile -Append -Encoding utf8
    try {
        $Command = 'node "src/app.js" >> "' + $LogFile + '" 2>> "' + $ErrorLogFile + '"'
        $Process = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList "/d", "/s", "/c", $Command `
            -WorkingDirectory $ApiDir `
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
