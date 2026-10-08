# Botlien UR gateway installer, for Windows. Run in PowerShell as Administrator:
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
# can move an arm. It opens no port of its own; it only sends out to Botlien.
$ErrorActionPreference = 'Stop'
$Botlien = '__BOTLIEN__'
$Files = @('gateway.mjs', 'arm.mjs', 'rtde.mjs', 'sender.mjs')
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

Write-Host 'Botlien UR gateway: reads your Universal Robots arms and sends their status to Botlien.'
Write-Host 'Read only. It can never move or change an arm.'
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
Write-Host "Now the arms. For each one, its IP address on your network (on the teach pendant: Settings > System > Network)."
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
if ($arms.Count -eq 0) { Fail "No arms given. Run this again with at least one arm's IP address." }

# ---- download and configure ----
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
foreach ($f in $Files) { Invoke-WebRequest -UseBasicParsing -Uri "$Botlien/gateway/files/$f" -OutFile (Join-Path $Dir $f) }
[ordered]@{ botlien = $Botlien; heartbeatSeconds = 15; frequency = 10; arms = $arms } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Dir 'gateway.json')
$keyFile = Join-Path $Dir 'key.txt'
Set-Content -NoNewline -Encoding ASCII -Path $keyFile -Value $key
# Only the system and administrators can read the key.
icacls $keyFile /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null
$run = Join-Path $Dir 'run.cmd'
@"
@echo off
set /p BOTLIEN_API_KEY=<"$keyFile"
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
