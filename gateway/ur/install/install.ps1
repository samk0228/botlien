# Botlien gateway installer (UR arms and MiR robots), for Windows. Run in PowerShell as Administrator:
#
#   irm __BOTLIEN__/gateway/install.ps1 | iex
#
# To remove it:  $env:BOTLIEN_UNINSTALL=1; irm __BOTLIEN__/gateway/install.ps1 | iex
#
# Runs on a PC that is already on the same network as the arms. It asks for
# the account's gateway key and each arm's IP, downloads the gateway from
# Botlien, and registers a startup task that runs it and restarts it if it stops.
#
# Read only. The gateway reads RTDE on port 30004 and refuses every port that
# can move an arm, and asks a MiR only GET questions. It opens no port of its
# own; it only sends out to Botlien.
$ErrorActionPreference = 'Stop'
$Botlien = '__BOTLIEN__'
$Files = @('gateway.mjs', 'arm.mjs', 'rtde.mjs', 'sender.mjs', 'mir.mjs')
$Dir = Join-Path $env:ProgramData 'BotlienGateway'
$Task = 'Botlien Gateway'

function Fail($m) { Write-Host "Botlien gateway: $m" -ForegroundColor Red; throw $m }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail 'Run PowerShell as Administrator (right-click, Run as administrator) and try again.' }

if ($env:BOTLIEN_UNINSTALL) {
  Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*BotlienGateway*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Remove-Item -Recurse -Force $Dir -ErrorAction SilentlyContinue
  Write-Host 'Botlien gateway removed from this computer.'
  return
}

Write-Host 'Botlien gateway: reads your Universal Robots arms and MiR robots and sends their status to Botlien.'
Write-Host 'Read only. It can never move or change a robot.'
Write-Host ''

# ---- Node 18 or newer ----
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'Node.js is not installed. Install Node 22 LTS from https://nodejs.org and run this again.' }
$major = [int](& $node -p 'process.versions.node.split(".")[0]')
if ($major -lt 18) { Fail "Node.js $major is too old. Install Node 22 LTS from https://nodejs.org and run this again." }

# ---- the account's key ----
$key = $env:BOTLIEN_API_KEY
if (-not $key) {
  $secure = Read-Host 'Gateway key (from Botlien, starts with blk_)' -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $key.StartsWith('blk_')) { Fail 'That is not a gateway key. Make one in Botlien (Connect robots, or Settings > Data sources).' }

# ---- the arms ----
Write-Host ''
Write-Host "First the Universal Robots arms. For each one, its IP address on your network (on the teach pendant: Settings > System > Network). Leave blank if you have none."
$arms = @()
while ($true) {
  $ip = (Read-Host "Arm $($arms.Count + 1) IP address (leave blank when done)").Trim()
  if (-not $ip) { break }
  if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$') { Write-Host '  That is not an IP address like 192.168.1.21. Try again.'; continue }
  $name = Read-Host "  Name for $ip (like Loader 1)"; if (-not $name) { $name = "Arm $($arms.Count + 1)" }
  $model = Read-Host '  Model [UR10e]'; if (-not $model) { $model = 'UR10e' }
  $client = New-Object Net.Sockets.TcpClient
  $reached = $client.ConnectAsync($ip, 30004).Wait(3000)
  $client.Close()
  if ($reached) { Write-Host "  Reached $ip on port 30004." } else { Write-Host "  Could not reach $ip on port 30004 yet. Check the arm is on and on this network. It will keep trying once installed." }
  $arms += [ordered]@{ id = 'arm-' + ($ip -replace '\.', '-'); host = $ip; name = $name; model = $model; category = 'machine_tending' }
}

# ---- the MiRs ----
Write-Host ''
Write-Host 'Now the MiR robots. For each one, its IP address (in the MiR web interface: System > Settings > WiFi).'
Write-Host 'If a MiR Fleet server runs them, type fleet and its address instead, like: fleet 10.0.0.5'
$mirs = @()
while ($true) {
  $entry = (Read-Host "MiR $($mirs.Count + 1) IP address (leave blank when done)").Trim()
  if (-not $entry) { break }
  $fleet = $entry -match '^fleet\s*'
  $addr = ($entry -replace '^fleet\s*', '').Trim()
  if ($addr -notmatch '^(\d{1,3}\.){3}\d{1,3}(:\d+)?$') { Write-Host '  That is not an IP address like 192.168.12.20. Try again.'; continue }
  $ip, $port = $addr -split ':'
  if ($fleet) { $name = 'MiR'; $model = $null }
  else {
    $name = Read-Host "  Name for $ip (like Tugger 1)"; if (-not $name) { $name = "MiR $($mirs.Count + 1)" }
    $model = Read-Host '  Model [MiR250]'; if (-not $model) { $model = 'MiR250' }
  }
  $client = New-Object Net.Sockets.TcpClient
  $reached = $client.ConnectAsync($ip, $(if ($port) { [int]$port } else { 80 })).Wait(3000)
  $client.Close()
  if ($reached) { Write-Host "  Reached $addr." } else { Write-Host "  Could not reach $addr yet. Check it is on and on this network. It will keep trying once installed." }
  $m = [ordered]@{ id = $(if ($fleet) { 'mirfleet-' } else { 'mir-' }) + ($ip -replace '\.', '-'); host = $ip; name = $name }
  if ($port) { $m.port = [int]$port }
  if ($fleet) { $m.fleet = $true } else { $m.model = $model }
  $mirs += $m
}
if ($arms.Count + $mirs.Count -eq 0) { Fail "No robots given. Run this again with at least one arm's or MiR's IP address." }
$mirAuth = $env:BOTLIEN_MIR_AUTH
if ($mirs.Count -gt 0 -and -not $mirAuth) {
  $user = Read-Host 'MiR login user (an API user from the MiR web interface, like distributor)'
  $secure = Read-Host 'Its password' -AsSecureString
  $mirAuth = $user + ':' + [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# ---- download and configure ----
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
foreach ($f in $Files) { Invoke-WebRequest -UseBasicParsing -Uri "$Botlien/gateway/files/$f" -OutFile (Join-Path $Dir $f) }
[ordered]@{ botlien = $Botlien; heartbeatSeconds = 15; frequency = 10; arms = @($arms); mir = @($mirs) } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Dir 'gateway.json')
$keyFile = Join-Path $Dir 'key.txt'
Set-Content -NoNewline -Encoding ASCII -Path $keyFile -Value $key
# Only the system and administrators can read the key.
icacls $keyFile /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null
$mirFile = Join-Path $Dir 'mir.txt'
if ($mirAuth) {
  Set-Content -NoNewline -Encoding ASCII -Path $mirFile -Value $mirAuth
  icacls $mirFile /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null
}
$run = Join-Path $Dir 'run.cmd'
@"
@echo off
set /p BOTLIEN_API_KEY=<"$keyFile"
if exist "$mirFile" set /p BOTLIEN_MIR_AUTH=<"$mirFile"
"$node" "$Dir\gateway.mjs" "$Dir\gateway.json" >> "$Dir\gateway.log" 2>&1
"@ | Set-Content -Encoding ASCII $run

# ---- start it, and keep it running ----
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$run`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $Task
Write-Host ''
Write-Host 'Installed and running. It starts by itself after a reboot.'
Write-Host "Log: $Dir\gateway.log"
Write-Host 'Your robots show up in Botlien within a minute of their first readings.'
