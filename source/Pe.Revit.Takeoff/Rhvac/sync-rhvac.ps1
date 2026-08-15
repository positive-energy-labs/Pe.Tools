# Surgical sync safety wrapper for RHVAC .r10 files: copy -> mutate -> validate -> atomic swap
# with a timestamped backup. The geometry/blob codec and every SQL statement live in
# export-rhvac.ps1 next to this script; this script owns only the safety envelope around it.
#
#   powershell -File sync-rhvac.ps1 -Target project.r10 -EditsJson edits.json
#   powershell -File sync-rhvac.ps1 -Target project.r10 -RoomsJson rooms.json
#   powershell -File sync-rhvac.ps1 -Target project.r10 -SyncJson sync.json -ResultJson result.json
#   powershell -File sync-rhvac.ps1 -Target project.r10 -SyncJson sync.json -WhatIf
#
# The -SyncJson lane is the one `rhvac.sync` calls: system seeding + inserts + updates + deletes +
# the template seed-room decision in one pass. -ResultJson receives the lane's result (fileIdentity,
# seeded systems, inserted room number -> Identifier, seed-room decision, assembly fallbacks) plus
# this envelope's backupPath and before/after room counts.
#
# Runs from any PowerShell; it spawns the 32-bit Jet lane itself.
#
# ---------------------------------------------------------------------------------------------
# PROVEN on eval/rhvac/project-a/projectA.local.r10 (150 rooms), evidence in
# eval/rhvac/project-a/UPSERT-PROBE.md, and on the firm template, evidence in
# eval/rhvac/template/SYSTEM-INSERT-PROBE.md:
#   * Row-level UPDATE of Room by Identifier changes exactly the targeted columns. A full 26,103-
#     line row-level dump of all 18 tables diffed to exactly the 2 lines written.
#   * LONGBINARY blob writes round-trip exactly, including growing blobs and 20-column bulk
#     UPDATE statements; adjacent LONGCHAR columns (Description, RoomNotes) are NOT mangled.
#   * INSERT INTO Room adds exactly one row and touches no other table (105 added dump lines =
#     the new row's 105 columns). No sibling row in any other table is required.
#   * INSERT INTO System by cloning an existing row differs from its source in exactly 3 of 237
#     columns (Number, Identifier, Description) and changes no other table.
#   * Room.Identifier and System.Identifier are Jet COUNTERs assigned automatically; the [Number]
#     of both is the PRIMARY KEY (unique, NOT NULL) and must be supplied.
#   * The schema declares NO foreign keys, so DELETE cascades to nothing and orphans nothing the
#     engine enforces -- which is why this lane validates Room.SystemNumber itself.
#   * Opening the file read-only through the Jet ODBC driver does not alter a single byte.
#
# UNPROVEN:
#   * Whether Elite RHVAC opens a file with SEEDED SYSTEMS and recalculates cleanly. (Surgical
#     room UPDATE has been confirmed live -- see DECISIONS.md -- the system path has not.)
#   * RHVAC's own invariants (System/Results totals left stale by design, duct-design references)
#     are not validated here; RHVAC owns recalculation.
# ---------------------------------------------------------------------------------------------
[CmdletBinding(DefaultParameterSetName = 'Edit')]
param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory, ParameterSetName = 'Edit')][string]$EditsJson,
    [Parameter(Mandatory, ParameterSetName = 'Insert')][string]$RoomsJson,
    [Parameter(Mandatory, ParameterSetName = 'Sync')][string]$SyncJson,
    [Parameter(ParameterSetName = 'Sync')][string]$ResultJson,
    [string]$BackupDir,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$lane = $PSCmdlet.ParameterSetName
$ps32 = 'C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
$exportScript = Join-Path $PSScriptRoot 'export-rhvac.ps1'
$targetPath = [IO.Path]::GetFullPath($Target)
if (![IO.File]::Exists($targetPath)) { throw "Target .r10 not found: $targetPath" }
if (![IO.File]::Exists($exportScript)) { throw "Export lane not found: $exportScript" }

# --- 1. Refuse while RHVAC (or anything else) holds the file ---------------------------------
# Jet drops a sibling .ldb while a database is open; an exclusive handle is the direct check.
$lockFile = [IO.Path]::ChangeExtension($targetPath, '.ldb')
if ([IO.File]::Exists($lockFile)) { throw "A Jet lock file exists ($lockFile); close the project in RHVAC first." }
try { ([IO.File]::Open($targetPath, 'Open', 'ReadWrite', 'None')).Dispose() }
catch { throw "Cannot take an exclusive handle on $targetPath; close the project in RHVAC first. ($($_.Exception.Message))" }

# --- 2. Census helper: table row counts + the Room identity map, read through the 32-bit lane --
$censusScript = Join-Path ([IO.Path]::GetTempPath()) "rhvac-census-$PID.ps1"
@'
param([Parameter(Mandatory)][string]$Path)
Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
$c = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$([IO.Path]::GetFullPath($Path));Uid=Admin;Pwd=;")
$c.Open()
try {
    foreach ($t in @($c.GetSchema('Tables') | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } | ForEach-Object TABLE_NAME | Sort-Object)) {
        $k = $c.CreateCommand(); $k.CommandText = "SELECT COUNT(*) FROM [$t]"
        "COUNT`t$t`t$($k.ExecuteScalar())"; $k.Dispose()
    }
    $k = $c.CreateCommand(); $k.CommandText = 'SELECT Identifier, [Number], Description FROM [Room] ORDER BY Identifier'
    $r = $k.ExecuteReader()
    while ($r.Read()) { "ROOM`t$($r.GetValue(0))`t$($r.GetValue(1))`t$($r.GetValue(2))" }
    $r.Dispose(); $k.Dispose()
} finally { $c.Dispose() }
'@ | Set-Content -LiteralPath $censusScript -Encoding UTF8

function Get-Census([string]$path) {
    $lines = & $ps32 -NoProfile -ExecutionPolicy Bypass -File $censusScript -Path $path
    if ($LASTEXITCODE -ne 0) { throw "Census failed for $path" }
    $counts = [ordered]@{}
    # Plain hashtable, not [ordered]: an ordered dictionary indexed by an int is positional.
    $rooms = @{}
    foreach ($line in $lines) {
        $f = $line -split "`t"
        if ($f[0] -eq 'COUNT') { $counts[$f[1]] = [int]$f[2] }
        elseif ($f[0] -eq 'ROOM') { $rooms[[int]$f[1]] = @{ Number = [int]$f[2]; Description = $f[3] } }
    }
    return @{ Counts = $counts; Rooms = $rooms }
}

# --- 3. Mutate a working COPY; the target is never written in place ---------------------------
$workingPath = Join-Path ([IO.Path]::GetDirectoryName($targetPath)) ("{0}.sync-working{1}" -f
    [IO.Path]::GetFileNameWithoutExtension($targetPath), [IO.Path]::GetExtension($targetPath))
if ([IO.File]::Exists($workingPath)) { [IO.File]::Delete($workingPath) }

$before = Get-Census $targetPath
"BEFORE  rooms=$($before.Rooms.Count)  tables=$($before.Counts.Count)"

# The sync lane always writes a result document -- the envelope needs the lane's seed-room decision
# and seeded-system count to know what the row counts are allowed to be.
$laneResultPath = if ($lane -eq 'Sync') {
    if ($ResultJson) { [IO.Path]::GetFullPath($ResultJson) }
    else { Join-Path ([IO.Path]::GetTempPath()) "rhvac-sync-result-$PID.json" }
} else { $null }

$laneArguments = switch ($lane) {
    'Edit' { @('-File', $exportScript, '-EditsJson', [IO.Path]::GetFullPath($EditsJson), '-Source', $targetPath, '-Output', $workingPath) }
    'Insert' { @('-File', $exportScript, '-RoomsJson', [IO.Path]::GetFullPath($RoomsJson), '-Template', $targetPath, '-Output', $workingPath) }
    'Sync' { @('-File', $exportScript, '-SyncJson', [IO.Path]::GetFullPath($SyncJson), '-Source', $targetPath, '-Output', $workingPath, '-ResultJson', $laneResultPath) }
}
& $ps32 -NoProfile -ExecutionPolicy Bypass @laneArguments
if ($LASTEXITCODE -ne 0) { throw "Export lane failed; the target is untouched and $workingPath holds the failed attempt." }

$laneResult = $null
if ($lane -eq 'Sync') {
    if (![IO.File]::Exists($laneResultPath)) { throw "Sync lane reported success but wrote no result at $laneResultPath" }
    $laneResult = Get-Content -LiteralPath $laneResultPath -Raw | ConvertFrom-Json
}

function Write-SyncResult([object]$backupPath) {
    # The lane's result describes the working copy; the caller cares about the target. Rewrite the
    # path, add the envelope's own facts, and leave everything the lane reported untouched.
    if (!$ResultJson -or !$laneResult) { return }
    $laneResult.outputPath = $targetPath
    Add-Member -InputObject $laneResult -NotePropertyName targetPath -NotePropertyValue $targetPath -Force
    Add-Member -InputObject $laneResult -NotePropertyName backupPath -NotePropertyValue $backupPath -Force
    Add-Member -InputObject $laneResult -NotePropertyName swapped -NotePropertyValue ($null -ne $backupPath) -Force
    Add-Member -InputObject $laneResult -NotePropertyName roomsBefore -NotePropertyValue $before.Rooms.Count -Force
    Add-Member -InputObject $laneResult -NotePropertyName roomsAfter -NotePropertyValue $after.Rooms.Count -Force
    Add-Member -InputObject $laneResult -NotePropertyName workingPath -NotePropertyValue $workingPath -Force
    $laneResult | ConvertTo-Json -Depth 8 | Out-File -LiteralPath ([IO.Path]::GetFullPath($ResultJson)) -Encoding utf8
}

# --- 4. Validate the working copy before it is allowed anywhere near the target ---------------
$after = Get-Census $workingPath
"AFTER   rooms=$($after.Rooms.Count)  tables=$($after.Counts.Count)"

$failures = [Collections.Generic.List[string]]::new()
if ($after.Counts.Count -ne $before.Counts.Count) { [void]$failures.Add("Table count changed: $($before.Counts.Count) -> $($after.Counts.Count)") }

# System is the one non-Room table this lane may grow, and only by the systems it reports seeding.
$seededSystems = 0
if ($laneResult) { $seededSystems = @($laneResult.systems | Where-Object { $_.seeded }).Count }
foreach ($table in $before.Counts.Keys) {
    if ($table -eq 'Room') { continue }
    if (!$after.Counts.Contains($table)) { [void]$failures.Add("Table $table disappeared"); continue }
    $allowed = $before.Counts[$table] + $(if ($table -eq 'System') { $seededSystems } else { 0 })
    if ($after.Counts[$table] -ne $allowed) {
        [void]$failures.Add("Non-Room table $table changed row count: $($before.Counts[$table]) -> $($after.Counts[$table]) (allowed $allowed)")
    }
}
# Every surviving room keeps its Identifier; Number stays unique.
$numbers = [Collections.Generic.HashSet[int]]::new()
foreach ($id in $after.Rooms.Keys) {
    if (!$numbers.Add($after.Rooms[$id].Number)) { [void]$failures.Add("Duplicate Room Number $($after.Rooms[$id].Number)") }
}
$expectedRooms = switch ($lane) {
    'Insert' { $before.Rooms.Count + @((Get-Content -LiteralPath $RoomsJson -Raw | ConvertFrom-Json)).Count }
    'Edit' {
        $edits = Get-Content -LiteralPath $EditsJson -Raw | ConvertFrom-Json
        $deleteCount = 0; if ($edits.PSObject.Properties['deletes']) { $deleteCount = @($edits.deletes).Count }
        $before.Rooms.Count - $deleteCount
    }
    'Sync' {
        $before.Rooms.Count + @($laneResult.insertedRooms).Count - @($laneResult.deleted).Count -
            $(if ($laneResult.seedRoom.action -eq 'deleted') { 1 } else { 0 })
    }
}
if ($after.Rooms.Count -ne $expectedRooms) { [void]$failures.Add("Room count $($after.Rooms.Count), expected $expectedRooms") }

# Inserted rooms must exist under the Identifier the lane reported -- that mapping is what the
# caller writes into Revit provenance, so a wrong one is worse than a failed sync.
if ($laneResult) {
    foreach ($room in @($laneResult.insertedRooms)) {
        $identifier = [int]$room.identifier
        if (!$after.Rooms.ContainsKey($identifier)) {
            [void]$failures.Add("Inserted room $($room.number) reported Identifier $identifier, which is not in the file")
        } elseif ($after.Rooms[$identifier].Number -ne [int]$room.number) {
            [void]$failures.Add("Identifier $identifier holds Number $($after.Rooms[$identifier].Number), not the reported $($room.number)")
        }
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { "VALIDATION FAILED: $_" }
    throw "Validation failed; the target is untouched. Inspect $workingPath."
}
"VALIDATED: non-Room tables unchanged (System +$seededSystems), room count $($after.Rooms.Count) as expected, Numbers unique."

if ($WhatIf) {
    "WHATIF: target left untouched; validated candidate is $workingPath"
    Write-SyncResult $null
    return
}

# --- 5. Atomic swap with a timestamped backup ------------------------------------------------
# File.Replace is the single-call NTFS replace-with-backup; there is no window where the target
# is missing.
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$backupRoot = if ($BackupDir) { [IO.Path]::GetFullPath($BackupDir) } else { [IO.Path]::GetDirectoryName($targetPath) }
if (![IO.Directory]::Exists($backupRoot)) { [void][IO.Directory]::CreateDirectory($backupRoot) }
$backupPath = Join-Path $backupRoot ("{0}.{1}.bak{2}" -f
    [IO.Path]::GetFileNameWithoutExtension($targetPath), $stamp, [IO.Path]::GetExtension($targetPath))
[IO.File]::Replace($workingPath, $targetPath, $backupPath, $true)
"SWAPPED -> $targetPath   backup: $backupPath"
Write-SyncResult $backupPath
Remove-Item -LiteralPath $censusScript -Force -ErrorAction SilentlyContinue
