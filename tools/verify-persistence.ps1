param([string]$BaseUrl = 'http://localhost:5738')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$base = "$BaseUrl/api/v1"
$headers = @{ 'X-Requested-With' = 'astracode' }
$suffix = [Guid]::NewGuid().ToString('N')
$credentials = @{ email = "persistence-$suffix@example.test"; name = "persistence $suffix" } | ConvertTo-Json
Invoke-RestMethod "$base/auth/login" -Method Post -Headers $headers -ContentType application/json -Body $credentials -SessionVariable astraSession | Out-Null
$fixture = $null
try {
    $body = @{ name = "persistence-$suffix"; files = @(@{ path = 'persist.txt'; code = "persistent-$suffix" }) } | ConvertTo-Json -Depth 5
    $fixture = Invoke-RestMethod "$base/projects" -Method Post -WebSession $astraSession -Headers $headers -ContentType application/json -Body $body
    # Windows PowerShell turns a native command's stderr into a terminating error while
    # ErrorActionPreference is Stop, and compose reports progress there, so relax it here.
    try {
        $ErrorActionPreference = 'Continue'
        docker compose restart postgres backend 2>&1 | ForEach-Object { Write-Host $_ }
        $restartExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    if ($restartExit -ne 0) { throw 'Service restart failed' }
    $ready = $false
    for ($i=0; $i -lt 60; $i++) {
        try { Invoke-RestMethod "$base/health/ready" -TimeoutSec 2 | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 1000 }
    }
    if (-not $ready) { throw 'API did not become ready after restart' }
    $who = Invoke-RestMethod "$base/auth/me" -WebSession $astraSession
    $project = Invoke-RestMethod "$base/projects/$($fixture.id)" -WebSession $astraSession
    $file = Invoke-RestMethod "$base/projects/$($fixture.id)/file?path=persist.txt" -WebSession $astraSession
    if ($project.name -ne "persistence-$suffix" -or $file.code -ne "persistent-$suffix" -or $who.email -ne "persistence-$suffix@example.test" -or $who.name -ne "persistence $suffix") { throw 'Persistence mismatch' }
    Write-Host 'PASS session, project metadata and file content survive PostgreSQL + API restart'
}
finally {
    if ($fixture) { Invoke-RestMethod "$base/projects/$($fixture.id)" -Method Delete -WebSession $astraSession -Headers $headers | Out-Null }
    Invoke-RestMethod "$base/auth/logout" -Method Post -WebSession $astraSession -Headers $headers | Out-Null
}
