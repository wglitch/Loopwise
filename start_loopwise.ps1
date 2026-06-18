param(
    [int]$Port = 8004
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:CONTACT_EMAIL = "mailto:loopwise@example.com"

$venv = Join-Path $root ".venv"
$python = "python"

if (-not (Test-Path -LiteralPath $venv)) {
    & $python -m venv $venv
}

$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $root "requirements.txt")
& $venvPython (Join-Path $root "server.py") --host 127.0.0.1 --port $Port
