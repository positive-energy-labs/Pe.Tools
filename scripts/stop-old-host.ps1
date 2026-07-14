# Interim install-walkthrough helper (2026-07): stop any running Pe host process before an MSI
# install/upgrade, so the legacy-retire and payload-stage steps never race locked files. The old
# C# host and the new TS host both run as Pe.Host.exe. Safe to run repeatedly; prints what it did.
# Durable fix lands via the kernel's service-shutdown path — this script exists for machines still
# carrying a pre-seam host that no supervisor can reach.
$stopped = 0
Get-Process -Name 'Pe.Host' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "stopping Pe.Host (pid $($_.Id)) at $($_.Path)"
    Stop-Process -Id $_.Id -Force
    $stopped++
}
if ($stopped -eq 0) { Write-Host 'no running Pe.Host process found — nothing to stop' }
else { Write-Host "stopped $stopped host process(es); proceed with the installer" }
