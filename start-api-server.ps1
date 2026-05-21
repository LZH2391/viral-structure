Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptPath = $PSCommandPath

function Start-WorkbenchStack {
  $repoRoot = Split-Path -Parent $script:scriptPath
  Set-Location $repoRoot

  if (-not $env:PORT) { $env:PORT = "5177" }
  if (-not $env:VITE_PORT) { $env:VITE_PORT = "5178" }
  if (-not $env:APP_SERVER_URL) { $env:APP_SERVER_URL = "ws://127.0.0.1:8146" }
  if (-not $env:THREADPOOL_PORT) { $env:THREADPOOL_PORT = "8877" }
  if (-not $env:THREADPOOL_WORKSPACE_ROOT) { $env:THREADPOOL_WORKSPACE_ROOT = $repoRoot }
  if (-not $env:THREADPOOL_CONFIG_PATH) { $env:THREADPOOL_CONFIG_PATH = Join-Path $repoRoot "Infrastructure\ThreadPool\thread_roles.json" }
  if (-not $env:PYTHON_RUNTIME_ROOT) { $env:PYTHON_RUNTIME_ROOT = Join-Path $repoRoot "Infrastructure\AgentRuntime" }
  if (-not $env:CEP_WORKSPACE_ROOT) { $env:CEP_WORKSPACE_ROOT = "C:\Users\Administrator\AppData\Roaming\Adobe\CEP\extensions" }
  if (-not $env:CEP_WORKSPACE_CORE_ROOT) { $env:CEP_WORKSPACE_CORE_ROOT = Join-Path $env:CEP_WORKSPACE_ROOT "AE_WorkspaceCore" }

  $env:CODEX_APP_SERVER_WS_URL = $env:APP_SERVER_URL
  $env:THREADPOOL_BASE_URL = "http://127.0.0.1:$($env:THREADPOOL_PORT)"
  $env:THREADPOOL_ALLOWED_ROLES = "shot-boundary-analyzer"

  $apiPort = [int]$env:PORT
  $vitePort = [int]$env:VITE_PORT
  $threadPoolPort = [int]$env:THREADPOOL_PORT
  $appServerPort = [int]([uri]$env:CODEX_APP_SERVER_WS_URL).Port
  $apiUrl = "http://127.0.0.1:$apiPort/"
  $viteUrl = "http://127.0.0.1:$vitePort/"
  $threadPoolHealthUrl = "$($env:THREADPOOL_BASE_URL)/health"
  $threadPoolScript = Join-Path $env:PYTHON_RUNTIME_ROOT "scripts\thread_pool_service.py"
  if (-not (Test-Path $threadPoolScript) -and (Test-Path $env:CEP_WORKSPACE_CORE_ROOT)) {
    $threadPoolScript = Join-Path $env:CEP_WORKSPACE_CORE_ROOT "scripts\thread_pool_service.py"
  }

  $node = Resolve-CommandPath @("node.exe", "node")
  $npm = Resolve-CommandPath @("npm.cmd", "npm")
  $python = Resolve-CommandPath @("python.exe", "python")
  $codex = Resolve-CommandPath @("codex.cmd", "codex")

  if (-not (Test-Path $threadPoolScript)) {
    throw "ThreadPool service script not found: $threadPoolScript"
  }
  if (-not (Test-Path $env:THREADPOOL_CONFIG_PATH)) {
    throw "ThreadPool role config not found: $($env:THREADPOOL_CONFIG_PATH)"
  }
  if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    & $npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed."
    }
  }

  $serviceSpecs = @(
    @{
      Name = "Codex AppServer"
      Kind = "appserver"
      Port = $appServerPort
      Ready = { Test-TcpPort $appServerPort }
      Start = { Start-ManagedProcess "Codex AppServer" $codex @("app-server", "--listen", $env:CODEX_APP_SERVER_WS_URL) $repoRoot }
    },
    @{
      Name = "ThreadPool"
      Kind = "threadpool"
      Port = $threadPoolPort
      Ready = { Test-HttpOk $threadPoolHealthUrl }
      Start = {
        $threadPoolWorkdir = if ($threadPoolScript.StartsWith($env:PYTHON_RUNTIME_ROOT, [System.StringComparison]::OrdinalIgnoreCase)) { $repoRoot } else { $env:CEP_WORKSPACE_CORE_ROOT }
        Start-ManagedProcess "ThreadPool" $python @($threadPoolScript, "--workspace-root", $env:THREADPOOL_WORKSPACE_ROOT, "--config-path", $env:THREADPOOL_CONFIG_PATH, "--port", $env:THREADPOOL_PORT, "--transport-url", $env:CODEX_APP_SERVER_WS_URL) $threadPoolWorkdir
      }
    },
    @{
      Name = "API server"
      Kind = "api"
      Port = $apiPort
      Ready = { Test-HttpOk $apiUrl }
      Start = { Start-ManagedProcess "API server" $node @("Apps\Api\server.js") $repoRoot }
    },
    @{
      Name = "Vite dev server"
      Kind = "vite"
      Port = $vitePort
      Ready = { Test-HttpOk $viteUrl }
      Start = { Start-ManagedProcess "Vite dev server" $npm @("run", "dev:workbench", "--", "--port", $env:VITE_PORT) $repoRoot }
    }
  )

  $managedProcesses = New-Object System.Collections.Generic.List[object]

  Write-Host "API server target $apiUrl"
  Write-Host "Vite dev server target $viteUrl"
  Write-Host "Codex AppServer target $($env:CODEX_APP_SERVER_WS_URL)"
  Write-Host "ThreadPool target $threadPoolHealthUrl"
  Write-Host "Press Esc or Ctrl+C to stop all managed/reused services for this workspace."

  try {
    foreach ($spec in $serviceSpecs) {
      Ensure-Service $spec $managedProcesses
    }

    Start-Sleep -Milliseconds 1200
    Start-Process $viteUrl | Out-Null

    $canReadKeys = $true
    while ($true) {
      $hasKey = $false
      if ($canReadKeys) {
        try {
          $hasKey = [Console]::KeyAvailable
        } catch {
          $canReadKeys = $false
        }
      }
      if ($hasKey) {
        $key = [Console]::ReadKey($true)
        if ($key.Key -eq [ConsoleKey]::Escape) { break }
      }
      Start-Sleep -Milliseconds 200
    }
  } finally {
    Stop-ManagedServices $managedProcesses
    Write-Host "Workbench, ThreadPool, and AppServer services stopped."
  }
}

function Resolve-CommandPath([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  throw "$($Candidates[0]) not found in PATH."
}

function Start-ManagedProcess([string]$Name, [string]$FilePath, [object[]]$ArgumentList, [string]$WorkingDirectory) {
  Write-Host "$Name starting..."
  return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru
}

function Ensure-Service($Spec, $Registry) {
  $existing = Get-ListeningProcessInfo $Spec.Port
  if ($existing) {
    if (-not (Test-ServiceMatch $Spec $existing)) {
      throw "$($Spec.Name) port $($Spec.Port) is occupied by non-workspace process PID $($existing.ProcessId): $($existing.CommandLine)"
    }
    Write-Host "$($Spec.Name) already online, managing existing PID $($existing.ProcessId)."
    Add-ManagedProcess $Registry $Spec $existing.ProcessId $true
    return
  }

  $process = & $Spec.Start
  Add-ManagedProcess $Registry $Spec $process.Id $false
  Wait-ForService $Spec
}

function Add-ManagedProcess($Registry, $Spec, [int]$ProcessId, [bool]$Reused) {
  if ($Registry | Where-Object { $_.ProcessId -eq $ProcessId -and $_.Port -eq $Spec.Port }) { return }
  $Registry.Add([pscustomobject]@{
      Name = $Spec.Name
      Kind = $Spec.Kind
      Port = $Spec.Port
      ProcessId = $ProcessId
      Reused = $Reused
    }) | Out-Null
}

function Wait-ForService($Spec) {
  $attempts = switch ($Spec.Kind) {
    "threadpool" { 80 }
    default { 50 }
  }
  $sleepMs = switch ($Spec.Kind) {
    "threadpool" { 250 }
    default { 200 }
  }
  for ($index = 0; $index -lt $attempts; $index += 1) {
    if (& $Spec.Ready) { return }
    Start-Sleep -Milliseconds $sleepMs
  }
  throw "$($Spec.Name) did not become reachable."
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 1
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-TcpPort([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(350)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-ListeningProcessInfo([int]$Port) {
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  $pid = [int]$connection.OwningProcess
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
  if (-not $process) { return [pscustomobject]@{ ProcessId = $pid; CommandLine = ""; Name = "" } }
  return [pscustomobject]@{
    ProcessId = $pid
    CommandLine = if ($null -ne $process.CommandLine) { [string]$process.CommandLine } else { "" }
    Name = if ($null -ne $process.Name) { [string]$process.Name } else { "" }
  }
}

function Test-ServiceMatch($Spec, $ProcessInfo) {
  $commandLine = [string]$ProcessInfo.CommandLine
  switch ($Spec.Kind) {
    "api" {
      return ($commandLine -match "Apps\\Api\\server\.js") -or ($commandLine -match [regex]::Escape((Join-Path $repoRoot "Apps\Api\server.js")))
    }
    "vite" {
      return ($commandLine -match "dev:workbench") -or (($commandLine -match "vite") -and ($commandLine -match [regex]::Escape($repoRoot)))
    }
    "threadpool" {
      return ($commandLine -match "thread_pool_service\.py") -and ($commandLine -match [regex]::Escape($env:THREADPOOL_CONFIG_PATH))
    }
    "appserver" {
      return ($commandLine -match "app-server") -and ($commandLine -match [regex]::Escape($env:CODEX_APP_SERVER_WS_URL))
    }
    default {
      return $false
    }
  }
}

function Stop-ManagedServices($Registry) {
  $stopOrder = @("Vite dev server", "API server", "ThreadPool", "Codex AppServer")
  foreach ($name in $stopOrder) {
    foreach ($entry in @($Registry | Where-Object { $_.Name -eq $name })) {
      Stop-ManagedProcessTree $entry
    }
  }
}

function Stop-ManagedProcessTree($Entry) {
  $process = Get-Process -Id $Entry.ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return }
  Write-Host "Stopping $($Entry.Name) PID $($Entry.ProcessId)..."
  $ids = Get-ProcessTreeIds $Entry.ProcessId
  foreach ($id in ($ids | Sort-Object -Descending)) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

function Get-ProcessTreeIds([int]$RootPid) {
  $pending = New-Object System.Collections.Generic.Queue[int]
  $seen = New-Object System.Collections.Generic.HashSet[int]
  $pending.Enqueue($RootPid)
  while ($pending.Count -gt 0) {
    $pid = $pending.Dequeue()
    if (-not $seen.Add($pid)) { continue }
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $pid" -ErrorAction SilentlyContinue
    foreach ($child in @($children)) {
      $pending.Enqueue([int]$child.ProcessId)
    }
  }
  return $seen.ToArray()
}

Start-WorkbenchStack
