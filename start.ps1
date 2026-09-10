# IDE Code - start the container on the first free port (5738 by default).
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Test-PortFree([int]$p) {
    try { -not (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
    catch { $true }
}

$port = 5738
$envLines = @()
if (Test-Path -LiteralPath '.env') {
    $envLines = @(Get-Content -LiteralPath '.env')
    $configured = $envLines | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -First 1
    if ($configured) { $port = [int]($configured -replace '^PORT=', '') }
}
$runningPort = docker compose port ide-code 80 2>$null
if ($LASTEXITCODE -eq 0 -and $runningPort -match ':(\d+)$') {
    $port = [int]$Matches[1]
}
elseif (-not (Test-PortFree $port)) {
    $free = 5739..5758 | Where-Object { Test-PortFree $_ } | Select-Object -First 1
    if (-not $free) { Write-Host "No free port in 5738..5758" -ForegroundColor Red; exit 1 }
    Write-Host "Port 5738 is busy, using $free instead." -ForegroundColor Yellow
    $port = $free
}

$envLines = @($envLines | Where-Object { $_ -notmatch '^PORT=' }) + "PORT=$port"
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), $envLines, [Text.UTF8Encoding]::new($false))

docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "docker compose failed - is Docker Desktop running?" -ForegroundColor Red; exit 1 }

$url = "http://localhost:$port"
Write-Host ""
Write-Host "IDE Code is up: $url" -ForegroundColor Green
Write-Host "Logs:  docker compose logs -f"
Write-Host "Stop:  docker compose down"
Start-Process $url
