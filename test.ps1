# Repeatable development pipeline. Does not delete application volumes.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$reportDir = Join-Path $PSScriptRoot 'test-results'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

function Run-Check([string]$Name, [string[]]$DockerArgs) {
    Write-Host "Running: $Name"
    try {
        $ErrorActionPreference = 'Continue'
        & docker @DockerArgs 2>&1 | Tee-Object -FilePath (Join-Path $reportDir "$Name.log")
        $checkExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    if ($checkExit -ne 0) { throw "$Name failed with exit code $checkExit" }
}
Run-Check 'compose-config' @('compose','config','--quiet')
Run-Check 'build' @('compose','build')
Run-Check 'test-image' @('compose','--profile','test','build','backend-test')
Run-Check 'dom-image' @('compose','--profile','test','build','frontend-test')
Run-Check 'start' @('compose','up','-d','--wait')
Run-Check 'go-vet' @('compose','--profile','test','run','--rm','--no-deps','backend-test','go','vet','./...')
Run-Check 'api-race' @('compose','--profile','test','run','--rm','--no-deps','backend-test','go','test','-race','-count=1','-v','./...')
Run-Check 'migration-roundtrip' @('compose','run','--rm','--no-deps','--entrypoint','python','migrations','verify_roundtrip.py')
Run-Check 'frontend-dom' @('compose','--profile','test','run','--rm','--no-deps','frontend-test')
$binding = docker compose port ide-code 80
if ($binding -notmatch ':(\d+)$') { throw 'Could not determine web port for persistence test' }
& (Join-Path $PSScriptRoot 'tools/verify-persistence.ps1') -BaseUrl "http://localhost:$($Matches[1])" 2>&1 | Tee-Object -FilePath (Join-Path $reportDir 'persistence.log')
Write-Host "Pipeline passed. Reports: $reportDir" -ForegroundColor Green
