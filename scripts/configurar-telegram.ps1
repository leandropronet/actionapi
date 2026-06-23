[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw ".env não encontrado em $EnvFile"
}

$SecureToken = Read-Host "Cole o token fornecido pelo @BotFather" -AsSecureString
$TokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPtr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPtr)
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "Token vazio."
}

$Me = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$Token/getMe" `
    -Method Get `
    -TimeoutSec 15
if (-not $Me.ok) {
    throw "O Telegram rejeitou o token."
}
Write-Host "Bot validado: @$($Me.result.username)"

$Updates = Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$Token/getUpdates" `
    -Method Get `
    -TimeoutSec 15

$Chats = @(
    $Updates.result |
        ForEach-Object {
            $Message = if ($_.message) { $_.message } elseif ($_.channel_post) { $_.channel_post } else { $null }
            if ($Message -and $Message.chat) {
                [pscustomobject]@{
                    Id = [string]$Message.chat.id
                    Nome = @(
                        $Message.chat.title,
                        $Message.chat.first_name,
                        $Message.chat.username
                    ) | Where-Object { $_ } | Select-Object -First 1
                    Tipo = $Message.chat.type
                }
            }
        } |
        Sort-Object Id -Unique
)

if ($Chats.Count -eq 0) {
    throw "Nenhum chat encontrado. Envie uma mensagem ao bot e execute novamente."
}

if ($Chats.Count -eq 1) {
    $ChatId = $Chats[0].Id
    Write-Host "Chat encontrado: $($Chats[0].Nome) [$ChatId]"
}
else {
    Write-Host "Chats encontrados:"
    for ($Index = 0; $Index -lt $Chats.Count; $Index++) {
        Write-Host "[$($Index + 1)] $($Chats[$Index].Nome) - $($Chats[$Index].Tipo) - $($Chats[$Index].Id)"
    }
    $Choice = [int](Read-Host "Escolha o número do chat")
    if ($Choice -lt 1 -or $Choice -gt $Chats.Count) {
        throw "Escolha inválida."
    }
    $ChatId = $Chats[$Choice - 1].Id
}

$Lines = [Collections.Generic.List[string]](Get-Content -LiteralPath $EnvFile)
function Set-EnvValue {
    param([string]$Name, [string]$Value)
    $Found = $false
    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
        if ($Lines[$Index] -match "^$([regex]::Escape($Name))=") {
            $Lines[$Index] = "$Name=$Value"
            $Found = $true
        }
    }
    if (-not $Found) {
        $Lines.Add("$Name=$Value")
    }
}

Set-EnvValue "TELEGRAM_BOT_TOKEN" $Token
Set-EnvValue "TELEGRAM_CHAT_ID" $ChatId
[IO.File]::WriteAllLines($EnvFile, $Lines, [Text.UTF8Encoding]::new($false))

$Body = @{
    chat_id = $ChatId
    text = "✅ ActionAPI ETL`nAlertas Telegram configurados com sucesso."
} | ConvertTo-Json
Invoke-RestMethod `
    -Uri "https://api.telegram.org/bot$Token/sendMessage" `
    -Method Post `
    -ContentType "application/json" `
    -Body $Body `
    -TimeoutSec 15 | Out-Null

$Task = Get-ScheduledTask -TaskName "ActionAPI-ETL" -ErrorAction SilentlyContinue
if ($Task) {
    Stop-ScheduledTask -TaskName "ActionAPI-ETL" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName "ActionAPI-ETL"
}

Write-Host "Configuração salva e mensagem de teste enviada."
