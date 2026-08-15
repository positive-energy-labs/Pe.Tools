# Asserts the expected end state of a sync-probe.json run against a scratch copy of the firm
# template. Fails loudly on the first wrong fact; prints one line per checked claim otherwise.
# Findings are recorded in SYNC-PROOF.md next to this script.
#
# MUST run 32-bit (Jet 3.5):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File verify-sync-probe.ps1 `
#       -Path <synced scratch copy>.r10
#
# Reads only.
param([Parameter(Mandatory)][string]$Path)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }
$ansi = [Text.Encoding]::Default

function Read-Serialized([object]$raw) {
    if ($null -eq $raw -or $raw -is [DBNull]) { return @() }
    $bytes = [byte[]]$raw
    if ($bytes.Length -ge 16 -and [BitConverter]::ToUInt16($bytes, 6) -eq 1) {
        $variantType = [BitConverter]::ToUInt16($bytes, 4)
        $count = [BitConverter]::ToInt32($bytes, 8)
        $offset = 16
        $values = [Collections.Generic.List[object]]::new()
        for ($item = 0; $item -lt $count; $item++) {
            switch ($variantType) {
                0x2003 { [void]$values.Add([BitConverter]::ToInt32($bytes, $offset)); $offset += 4 }
                0x2004 { [void]$values.Add([BitConverter]::ToSingle($bytes, $offset)); $offset += 4 }
                0x2008 {
                    $length = [BitConverter]::ToUInt16($bytes, $offset)
                    $offset += 2
                    [void]$values.Add($ansi.GetString($bytes, $offset, $length))
                    $offset += $length
                }
                0x200B { [void]$values.Add([BitConverter]::ToInt16($bytes, $offset)); $offset += 2 }
                default { throw ('Unsupported variant type 0x{0:X4}' -f $variantType) }
            }
        }
        return @($values)
    }
    $text = $ansi.GetString($bytes)
    return @($text.Substring($text.IndexOf('q') + 1))
}

$checks = 0
function Assert-Equal([string]$claim, [object]$expected, [object]$actual) {
    if ("$expected" -ne "$actual") { throw "FAILED: $claim -- expected '$expected', got '$actual'" }
    $script:checks++
    "OK  $claim = $actual"
}

$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$([IO.Path]::GetFullPath($Path));Uid=Admin;Pwd=;")
try {
    $connection.Open()

    # --- systems: 2 seeded by name, the template's originals untouched --------------------------
    $systems = @{}
    $systemCommand = $connection.CreateCommand()
    $systemCommand.CommandText = 'SELECT [Number], Identifier, Description, WinterIndoorDryBulb, SummerIndoorDryBulb FROM [System] ORDER BY [Number]'
    $systemReader = $systemCommand.ExecuteReader()
    while ($systemReader.Read()) {
        $systems[$systemReader.GetInt32(0)] = [ordered]@{
            Identifier = $systemReader.GetInt32(1)
            Name = $systemReader.GetString(2)
            Winter = $systemReader.GetValue(3)
            Summer = $systemReader.GetValue(4)
        }
    }
    $systemReader.Dispose()
    $systemCommand.Dispose()

    Assert-Equal 'System count' 4 $systems.Count
    Assert-Equal 'System 1 name (template original, untouched)' 'Down' $systems[1].Name
    Assert-Equal 'System 2 name (template original, untouched)' 'Up' $systems[2].Name
    Assert-Equal 'System 3 name (seeded)' 'Great Room - IU-3' $systems[3].Name
    Assert-Equal 'System 4 name (seeded)' 'Primary Suite - IU-4' $systems[4].Name
    # Design conditions came across from the clone source, which is the whole point of cloning.
    Assert-Equal 'System 3 WinterIndoorDryBulb inherited from System 1' $systems[1].Winter $systems[3].Winter
    Assert-Equal 'System 4 SummerIndoorDryBulb inherited from System 1' $systems[1].Summer $systems[4].Summer

    # --- rooms ---------------------------------------------------------------------------------
    $adapter = [System.Data.Odbc.OdbcDataAdapter]::new('SELECT * FROM [Room] ORDER BY [Number]', $connection)
    $rooms = [System.Data.DataTable]::new()
    [void]$adapter.Fill($rooms)
    $adapter.Dispose()

    Assert-Equal 'Room count (2 inserted, blank seed room deleted)' 2 $rooms.Rows.Count
    $byNumber = @{}
    foreach ($row in $rooms.Rows) { $byNumber[[int]$row['Number']] = $row }
    if ($byNumber.ContainsKey(1)) { throw 'FAILED: the blank seed room (Number 1) is still present' }
    $script:checks++
    'OK  blank seed room (Number 1) is gone'

    $great = $byNumber[101]
    Assert-Equal 'Room 101 name' 'Great Room' $great['Description']
    Assert-Equal 'Room 101 SystemNumber' 3 $great['SystemNumber']
    Assert-Equal 'Room 101 area (Length x Width)' 420.5 ([double]$great['Length'] * [double]$great['Width'])
    Assert-Equal 'Room 101 wall count' '22,19' ((Read-Serialized $great['WallLength']) -join ',')
    Assert-Equal 'Room 101 glass wall reference' '1' ((Read-Serialized $great['GlassReference']) -join ',')
    Assert-Equal 'Room 101 door wall reference' '2' ((Read-Serialized $great['DoorReference']) -join ',')

    # The catalog's job: Manual-J CODE fields, not just the description text. These values are the
    # ones mined from the project-a rows using each assembly (assembly-presets.json).
    Assert-Equal 'Room 101 WallDescription (catalog assembly)' 'Tasting Room Wall,Tasting Room Wall' ((Read-Serialized $great['WallDescription']) -join ',')
    Assert-Equal 'Room 101 WallConstructionMaterial (catalog code field)' 'Tasting_Wall,Tasting_Wall' ((Read-Serialized $great['WallConstructionMaterial']) -join ',')
    Assert-Equal 'Room 101 WallGroupCode (catalog code field)' 'H,H' ((Read-Serialized $great['WallGroupCode']) -join ',')
    Assert-Equal 'Room 101 RoofConstructionMaterial (catalog code field)' 'R49 CC SPF in 2x14' ((Read-Serialized $great['RoofConstructionMaterial']) -join ',')
    Assert-Equal 'Room 101 GlassConstructionMaterial (catalog code field)' 'U-0.55 SHGC-0.40' ((Read-Serialized $great['GlassConstructionMaterial']) -join ',')
    Assert-Equal 'Room 101 DoorConstructionMaterial (catalog code field)' '11D' ((Read-Serialized $great['DoorConstructionMaterial']) -join ',')
    # Floor assembly came from the file itself (the template's own row), not the catalog.
    Assert-Equal 'Room 101 FloorDescription (assembly already in the file)' 'passive, heavy dry or light wet soil' ((Read-Serialized $great['FloorDescription']) -join ',')

    $bedroom = $byNumber[102]
    Assert-Equal 'Room 102 name' 'Primary Bedroom' $bedroom['Description']
    Assert-Equal 'Room 102 SystemNumber' 4 $bedroom['SystemNumber']
    Assert-Equal 'Room 102 people' 2 $bedroom['PeopleNumber']
    Assert-Equal 'Room 102 floor from catalog' 'WR R20' ((Read-Serialized $bedroom['FloorDescription']) -join ',')
    # The unresolvable wall assembly must land as ONE explicit zero row, never a guessed material.
    Assert-Equal 'Room 102 fallback WallLength is one zero row' '0' ((Read-Serialized $bedroom['WallLength']) -join ',')
    Assert-Equal 'Room 102 fallback WallDescription is empty' '' ((Read-Serialized $bedroom['WallDescription']) -join ',')
    Assert-Equal 'Room 102 fallback WallUValue is zero' '0' ((Read-Serialized $bedroom['WallUValue']) -join ',')
    Assert-Equal 'Room 102 empty roof category is one zero row' '0' ((Read-Serialized $bedroom['RoofLength']) -join ',')

    "PASSED $script:checks checks"
} finally {
    $connection.Dispose()
}
