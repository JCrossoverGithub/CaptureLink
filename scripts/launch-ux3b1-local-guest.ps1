# Launch a *separate* unbundled CaptureLink Electron process for UX3 local
# acceptance. Its userData/sessionData paths are set to a fresh temp directory
# by the guarded --capturelink-ux3-local-guest flag in src/main/index.ts.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$main = Join-Path $repo 'out\main\index.js'
$renderer = Join-Path $repo 'out\renderer\index.html'

foreach ($path in @($electron, $main, $renderer)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing $path - run npm.cmd run build and install the Electron binary first."
    }
}
if ($env:ELECTRON_RENDERER_URL) {
    throw 'ELECTRON_RENDERER_URL is set. Start this from a fresh PowerShell window without the dev-server environment.'
}

Write-Host 'Starting a second CaptureLink process with an isolated temporary guest profile.'
Write-Host 'It must NOT contain the host Xbox sign-in or application settings.'
Write-Host 'Keep the broker running only on 127.0.0.1:8787. Do not expose its port.'
$proc = Start-Process -FilePath $electron -ArgumentList @('.', '--capturelink-ux3-local-guest') -WorkingDirectory $repo -PassThru
Write-Host "Guest PID: $($proc.Id)"
Write-Host 'Guest window title: CaptureLink - ISOLATED LOCAL GUEST TEST'
Write-Host 'Do NOT sign the isolated guest into the host Xbox account.'
