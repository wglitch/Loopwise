param(
    [int]$Port = 8004
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:PORT = "$Port"
$env:HOST = "127.0.0.1"
$env:CONTACT_EMAIL = "mailto:loopwise@example.com"

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
    npm install
}

node server.js
