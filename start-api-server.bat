@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5177"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$env:PORT = '%PORT%';" ^
  "Write-Host ('API server starting on http://localhost:' + $env:PORT);" ^
  "Write-Host 'Keep this window open. Press Esc or Ctrl+C to stop the API server.';" ^
  "$node = Start-Process -FilePath 'node' -ArgumentList @('Apps\Api\server.js') -WorkingDirectory (Get-Location) -NoNewWindow -PassThru;" ^
  "$canReadKeys = $true;" ^
  "try {" ^
  "  while (-not $node.HasExited) {" ^
  "    $hasKey = $false;" ^
  "    if ($canReadKeys) { try { $hasKey = [Console]::KeyAvailable } catch { $canReadKeys = $false } }" ^
  "    if ($hasKey) {" ^
  "      $key = [Console]::ReadKey($true);" ^
  "      if ($key.Key -eq 'Escape') { break }" ^
  "    }" ^
  "    Start-Sleep -Milliseconds 200;" ^
  "  }" ^
  "} finally {" ^
  "  if ($node -and -not $node.HasExited) {" ^
  "    Write-Host 'Stopping API server...';" ^
  "    Stop-Process -Id $node.Id -Force;" ^
  "    $node.WaitForExit();" ^
  "  }" ^
  "}" ^
  "Write-Host 'API server stopped.'"

endlocal
