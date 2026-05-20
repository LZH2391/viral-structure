@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5177"
if "%VITE_PORT%"=="" set "VITE_PORT=5178"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found in PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$env:PORT = '%PORT%';" ^
  "$env:VITE_PORT = '%VITE_PORT%';" ^
  "$repo = Get-Location;" ^
  "$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source;" ^
  "if (-not $npm) { $npm = (Get-Command npm -ErrorAction Stop).Source }" ^
  "$apiUrl = 'http://127.0.0.1:' + $env:PORT + '/';" ^
  "$devUrl = 'http://127.0.0.1:' + $env:VITE_PORT + '/';" ^
  "Write-Host ('API server starting on ' + $apiUrl);" ^
  "Write-Host ('Vite dev server starting on ' + $devUrl);" ^
  "Write-Host 'Keep this window open. Press Esc or Ctrl+C to stop both servers.';" ^
  "$api = Start-Process -FilePath 'node' -ArgumentList @('Apps\Api\server.js') -WorkingDirectory $repo -NoNewWindow -PassThru;" ^
  "$vite = Start-Process -FilePath $npm -ArgumentList @('run','dev:workbench','--','--port',$env:VITE_PORT) -WorkingDirectory $repo -NoNewWindow -PassThru;" ^
  "Start-Sleep -Milliseconds 1200;" ^
  "Start-Process $devUrl;" ^
  "$canReadKeys = $true;" ^
  "try {" ^
  "  while (-not $api.HasExited -and -not $vite.HasExited) {" ^
  "    $hasKey = $false;" ^
  "    if ($canReadKeys) { try { $hasKey = [Console]::KeyAvailable } catch { $canReadKeys = $false } }" ^
  "    if ($hasKey) {" ^
  "      $key = [Console]::ReadKey($true);" ^
  "      if ($key.Key -eq 'Escape') { break }" ^
  "    }" ^
  "    Start-Sleep -Milliseconds 200;" ^
  "  }" ^
  "} finally {" ^
  "  foreach ($proc in @($api, $vite)) {" ^
  "    if ($proc -and -not $proc.HasExited) {" ^
  "      Stop-Process -Id $proc.Id -Force;" ^
  "      $proc.WaitForExit();" ^
  "    }" ^
  "  }" ^
  "}" ^
  "Write-Host 'Workbench dev servers stopped.'"

endlocal
