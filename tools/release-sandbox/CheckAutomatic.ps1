$ErrorActionPreference='Stop'
. "$PSScriptRoot\Boundary.ps1"
. "$PSScriptRoot\AutomaticBoundary.ps1"
$config=@{previousVersion='0.7.18';candidateVersion='0.7.19';files=@(@{role='candidateMsi';sha256=('a'*64)})}
$plan=@{planId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';product='Pe.Tools';current='0.7.18';latest='0.7.19';available=$true;installedRoot='C:\Product';feed='https://api.github.com/repos/owner/product/releases/latest';observedAtUtc='2026-10-11T17:01:00Z';quiet=$true;msi=@{digest=('sha256:'+('a'*64));size=1234};revits=@();blockers=@();effects=@{close=@();reopen=@();restartYears=@()}}
$admission=@{requestId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';planId=$plan.planId;admittedAtUtc='2026-10-11T17:01:01Z'}
$watch=[datetime]'2026-10-11T17:00:00Z';$hostStart=[datetime]'2026-10-11T16:57:00Z';$prior=@('cccccccc-cccc-cccc-cccc-cccccccccccc');$rows=@()
function Vector($name,$change,[bool]$accept) {
    $p=$plan | ConvertTo-Json -Depth 8 | ConvertFrom-Json;$a=$admission | ConvertTo-Json | ConvertFrom-Json
    & $change $a $p
    try {AssertAutomaticAdmission $a $p $config 1234 'C:\Product' $watch $prior $hostStart $plan.feed;$accepted=$true;$reason=''} catch {$accepted=$false;$reason=$_.Exception.Message}
    if($accepted -ne $accept){throw "Unexpected vector $name accepted=$accepted expected=$accept $reason"}
    $script:rows+=@{name=$name;accepted=$accepted;expected=$accept;reason=$reason}
}
Vector 'Actual admission may have different planId from observer recheck' {param($a,$p) $p.planId='dddddddd-dddd-dddd-dddd-dddddddddddd';$a.planId=$p.planId} $true
Vector 'Stale historical request' {param($a,$p) $a.requestId=$prior[0]} $false
Vector 'Admission before watch' {param($a,$p) $a.admittedAtUtc='2026-10-11T16:59:59Z'} $false
Vector 'Foreign install root' {param($a,$p) $p.installedRoot='C:\Foreign'} $false
Vector 'Different candidate digest' {param($a,$p) $p.msi.digest='sha256:'+('b'*64)} $false
Vector 'Different candidate size' {param($a,$p) $p.msi.size=1235} $false
Vector 'Different candidate version' {param($a,$p) $p.latest='0.7.20'} $false
Vector 'Different actual plan identity' {param($a,$p) $a.planId='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'} $false
Vector 'Foreign feed' {param($a,$p) $p.feed='https://foreign/feed'} $false
Vector 'Plan predates host incarnation' {param($a,$p) $p.observedAtUtc='2026-10-11T16:56:00Z'} $false
Vector 'Plan after admission' {param($a,$p) $p.observedAtUtc='2026-10-11T17:01:02Z'} $false
Vector 'Revit close effect' {param($a,$p) $p.effects.close=@(@{pid=123})} $false
Vector 'Busy plan' {param($a,$p) $p.quiet=$false} $false

Vector 'Malformed36char UUID' {param($a,$p) $a.requestId='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'} $false
if((Get-Content "$PSScriptRoot\Automatic.ps1" -Raw) -match 'Method Post|Start-Process|update.+apply'){throw 'Ordinary watcher contains lifecycle/update mutation'}
Write-Output 'PASS:14 actual admission identity/root/hash/time/feed/quiet vectors'
