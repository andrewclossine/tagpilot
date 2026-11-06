# Copies the newest TAGPILOT backup from the server to this computer (OneDrive), so a copy exists off the server.
# Runs once a day from Windows Task Scheduler. It only reads from the server: it never changes or deletes anything there.
# The server prints a notice on ssh's error stream; PowerShell must not treat it as a failure. Failures are checked by hand.
$ErrorActionPreference = 'Continue'
$Key    = 'C:\hrleave\hrleave.pem'
$Known  = 'C:\hrleave\known_hosts'
$Server = 'ubuntu@102.129.218.54'
# Git's ssh: Windows' own ssh refuses this key file because other users of the computer may read it.
$Ssh    = 'C:\Program Files\Git\usr\bin\ssh.exe'
if (-not (Test-Path $Ssh)) { $Ssh = 'C:\Windows\System32\OpenSSH\ssh.exe' }
$Dest   = Join-Path $env:USERPROFILE 'OneDrive\Documents\TAGPILOT backups'
if (Test-Path 'D:\OneDrive\Documents') { $Dest = 'D:\OneDrive\Documents\TAGPILOT backups' }
$Keep   = 30
$Log    = Join-Path $Dest 'backup-log.txt'
New-Item -ItemType Directory -Force -Path $Dest -ErrorAction Stop | Out-Null

$opts = "-i `"$Key`" -o IdentitiesOnly=yes -o UserKnownHostsFile=`"$Known`" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=30 -p 2200"
$out = $null
try {
  # The name of the newest copy on the server, e.g. tagpilot-2026-11-06-0230.tgz
  $name = (& $Ssh -i $Key -o IdentitiesOnly=yes -o UserKnownHostsFile=$Known -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=30 -p 2200 $Server "sudo sh -c 'ls -1t /var/backups/tagpilot/tagpilot-*.tgz | head -1 | xargs -r basename'" 2>$null | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or -not ($name -match '^tagpilot-[0-9-]+\.tgz$')) { throw "no backup found on the server (exit $LASTEXITCODE)" }
  $out = Join-Path $Dest $name
  if (Test-Path $out) { Add-Content $Log ("{0}  ALREADY  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $name); exit 0 }
  # cmd.exe keeps the archive bytes intact (PowerShell 5 redirection would alter them).
  cmd /c "`"$Ssh`" $opts $Server `"sudo cat /var/backups/tagpilot/$name`" > `"$out.part`""
  if ($LASTEXITCODE -ne 0 -or (Get-Item "$out.part").Length -lt 1000) { throw "download failed (exit $LASTEXITCODE)" }
  # Same size as on the server, or it is not kept.
  $size = (& $Ssh -i $Key -o IdentitiesOnly=yes -o UserKnownHostsFile=$Known -o BatchMode=yes -p 2200 $Server "sudo stat -c %s /var/backups/tagpilot/$name" 2>$null | Select-Object -Last 1)
  if ([int64]$size -ne (Get-Item "$out.part").Length) { throw "size differs: server $size, here $((Get-Item "$out.part").Length)" }
  Move-Item -Force "$out.part" $out -ErrorAction Stop
  Get-ChildItem $Dest -Filter 'tagpilot-*.tgz' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
  Add-Content $Log ("{0}  OK  {1}  {2:N0} KB" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $name, ((Get-Item $out).Length / 1KB))
} catch {
  if ($out -and (Test-Path "$out.part")) { Remove-Item "$out.part" -Force }
  Add-Content $Log ("{0}  FAILED  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $_.Exception.Message)
  exit 1
}
