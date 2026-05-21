@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5177"
if "%VITE_PORT%"=="" set "VITE_PORT=5178"
if "%APP_SERVER_URL%"=="" set "APP_SERVER_URL=ws://127.0.0.1:8146"
if "%THREADPOOL_PORT%"=="" set "THREADPOOL_PORT=8877"
if "%THREADPOOL_WORKSPACE_ROOT%"=="" set "THREADPOOL_WORKSPACE_ROOT=%~dp0"
if "%THREADPOOL_CONFIG_PATH%"=="" set "THREADPOOL_CONFIG_PATH=%~dp0Infrastructure\ThreadPool\thread_roles.json"
if "%CEP_WORKSPACE_ROOT%"=="" set "CEP_WORKSPACE_ROOT=C:\Users\Administrator\AppData\Roaming\Adobe\CEP\extensions"
if "%CEP_WORKSPACE_CORE_ROOT%"=="" set "CEP_WORKSPACE_CORE_ROOT=%CEP_WORKSPACE_ROOT%\AE_WorkspaceCore"

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

where python >nul 2>nul
if errorlevel 1 (
  echo python not found in PATH.
  pause
  exit /b 1
)

where codex >nul 2>nul
if errorlevel 1 (
  echo codex not found in PATH.
  pause
  exit /b 1
)

if not exist "%CEP_WORKSPACE_CORE_ROOT%\scripts\thread_pool_service.py" (
  echo ThreadPool service script not found:
  echo %CEP_WORKSPACE_CORE_ROOT%\scripts\thread_pool_service.py
  pause
  exit /b 1
)

if not exist "%THREADPOOL_CONFIG_PATH%" (
  echo ThreadPool role config not found:
  echo %THREADPOOL_CONFIG_PATH%
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
  "$env:CODEX_APP_SERVER_WS_URL = '%APP_SERVER_URL%';" ^
  "$env:THREADPOOL_BASE_URL = 'http://127.0.0.1:%THREADPOOL_PORT%';" ^
  "$env:THREADPOOL_ALLOWED_ROLES = 'shot-boundary-analyzer';" ^
  "$env:THREADPOOL_WORKSPACE_ROOT = '%THREADPOOL_WORKSPACE_ROOT%';" ^
  "$env:THREADPOOL_CONFIG_PATH = '%THREADPOOL_CONFIG_PATH%';" ^
  "$env:CEP_WORKSPACE_ROOT = '%CEP_WORKSPACE_ROOT%';" ^
  "$env:CEP_WORKSPACE_CORE_ROOT = '%CEP_WORKSPACE_CORE_ROOT%';" ^
  "$repo = Get-Location;" ^
  "$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source;" ^
  "if (-not $npm) { $npm = (Get-Command npm -ErrorAction Stop).Source }" ^
  "$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source;" ^
  "if (-not $python) { $python = (Get-Command python -ErrorAction Stop).Source }" ^
  "$codex = (Get-Command codex.cmd -ErrorAction SilentlyContinue).Source;" ^
  "if (-not $codex) { $codex = (Get-Command codex -ErrorAction Stop).Source }" ^
  "$apiUrl = 'http://127.0.0.1:' + $env:PORT + '/';" ^
  "$devUrl = 'http://127.0.0.1:' + $env:VITE_PORT + '/';" ^
  "$threadPoolUrl = $env:THREADPOOL_BASE_URL + '/health';" ^
  "$appServerPort = [int]([uri]$env:CODEX_APP_SERVER_WS_URL).Port;" ^
  "$started = New-Object System.Collections.Generic.List[object];" ^
  "function Test-TcpPort([int]$Port) { $client = New-Object Net.Sockets.TcpClient; try { $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null); if (-not $iar.AsyncWaitHandle.WaitOne(350)) { return $false }; $client.EndConnect($iar); return $true } catch { return $false } finally { $client.Close() } }" ^
  "function Test-HttpOk([string]$Url) { try { $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 1; return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500 } catch { return $false } }" ^
  "function Start-ManagedProcess([string]$Name, [string]$FilePath, [object[]]$ArgumentList, [string]$WorkingDirectory) { Write-Host ($Name + ' starting...'); $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru; $started.Add([pscustomobject]@{ Name = $Name; Process = $proc }) | Out-Null; return $proc }" ^
  "Write-Host ('API server starting on ' + $apiUrl);" ^
  "Write-Host ('Vite dev server starting on ' + $devUrl);" ^
  "Write-Host ('Codex AppServer target ' + $env:CODEX_APP_SERVER_WS_URL);" ^
  "Write-Host ('ThreadPool target http://127.0.0.1:' + '%THREADPOOL_PORT%');" ^
  "Write-Host 'Keep this window open. Press Esc or Ctrl+C to stop services started by this script.';" ^
  "$appServer = $null;" ^
  "if (Test-TcpPort $appServerPort) { Write-Host ('Codex AppServer already listening on port ' + $appServerPort + ', reusing it.'); } else { $appServer = Start-ManagedProcess 'Codex AppServer' $codex @('app-server','--listen',$env:CODEX_APP_SERVER_WS_URL) $repo }" ^
  "for ($i = 0; $i -lt 50 -and -not (Test-TcpPort $appServerPort); $i++) { Start-Sleep -Milliseconds 200 }" ^
  "if (-not (Test-TcpPort $appServerPort)) { throw 'Codex AppServer did not open its websocket port.' }" ^
  "$threadPool = $null;" ^
  "if (Test-HttpOk $threadPoolUrl) { Write-Host 'ThreadPool already online, reusing it.'; } else { $threadPoolScript = Join-Path $env:CEP_WORKSPACE_CORE_ROOT 'scripts\thread_pool_service.py'; $threadPool = Start-ManagedProcess 'ThreadPool' $python @($threadPoolScript,'--workspace-root',$env:THREADPOOL_WORKSPACE_ROOT,'--config-path',$env:THREADPOOL_CONFIG_PATH,'--port','%THREADPOOL_PORT%','--transport-url',$env:CODEX_APP_SERVER_WS_URL) $env:CEP_WORKSPACE_CORE_ROOT }" ^
  "for ($i = 0; $i -lt 80 -and -not (Test-HttpOk $threadPoolUrl); $i++) { Start-Sleep -Milliseconds 250 }" ^
  "if (-not (Test-HttpOk $threadPoolUrl)) { throw 'ThreadPool service did not become reachable.' }" ^
  "$api = Start-ManagedProcess 'API server' 'node' @('Apps\Api\server.js') $repo;" ^
  "$vite = Start-ManagedProcess 'Vite dev server' $npm @('run','dev:workbench','--','--port',$env:VITE_PORT) $repo;" ^
  "Start-Sleep -Milliseconds 1200;" ^
  "Start-Process $devUrl;" ^
  "$canReadKeys = $true;" ^
  "try {" ^
  "  while (($started | ForEach-Object { -not $_.Process.HasExited }) -contains $true) {" ^
  "    $hasKey = $false;" ^
  "    if ($canReadKeys) { try { $hasKey = [Console]::KeyAvailable } catch { $canReadKeys = $false } }" ^
  "    if ($hasKey) {" ^
  "      $key = [Console]::ReadKey($true);" ^
  "      if ($key.Key -eq 'Escape') { break }" ^
  "    }" ^
  "    Start-Sleep -Milliseconds 200;" ^
  "  }" ^
  "} finally {" ^
  "  foreach ($entry in @($started.ToArray() | Sort-Object { $_.Name -eq 'Codex AppServer' })) {" ^
  "    $proc = $entry.Process;" ^
  "    if ($proc -and -not $proc.HasExited) {" ^
  "      Write-Host ('Stopping ' + $entry.Name + '...');" ^
  "      Stop-Process -Id $proc.Id -Force;" ^
  "      $proc.WaitForExit();" ^
  "    }" ^
  "  }" ^
  "}" ^
  "Write-Host 'Workbench, ThreadPool, and AppServer services stopped.'"

endlocal
