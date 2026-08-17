# Probe: can a new RHVAC [System] row be seeded by cloning an existing one and overriding ONLY
# [Number] + [Description] (the engineer-facing system name)? Findings live in
# SYSTEM-INSERT-PROBE.md next to this script.
#
# MUST run 32-bit (Jet 3.5):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File system-insert-probe.ps1 `
#       -Path <scratch copy>.r10
#
# The probe WRITES the file it is given. Always hand it a scratch copy.
param(
    [Parameter(Mandatory)][string]$Path,
    [int]$CloneFrom = 1,
    [int]$NewNumber = 3,
    [string]$NewName = 'PROBE SYS 3'
)

Add-Type -AssemblyName System.Data
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 4) { throw 'Run under 32-bit PowerShell (SysWOW64); the Jet driver is 32-bit only.' }

$full = [IO.Path]::GetFullPath($Path)
$connection = [System.Data.Odbc.OdbcConnection]::new(
    "Driver={Microsoft Access Driver (*.mdb)};Dbq=$full;Uid=Admin;Pwd=;")

function Format-Value([object]$value) {
    if ($value -is [DBNull] -or $null -eq $value) { return '<null>' }
    if ($value -is [byte[]]) {
        $sha = [Security.Cryptography.SHA256]::Create().ComputeHash($value)
        return "<blob:$($value.Length):$(([BitConverter]::ToString($sha) -replace '-').Substring(0, 12))>"
    }
    return [string]$value
}

function Get-Census([object]$connection) {
    $census = [ordered]@{}
    foreach ($table in @($connection.GetSchema('Tables') | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } |
            ForEach-Object TABLE_NAME | Sort-Object)) {
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT COUNT(*) FROM [$table]"
        $census[$table] = [int]$command.ExecuteScalar()
        $command.Dispose()
    }
    return $census
}

function Get-SystemRow([object]$connection, [int]$number) {
    $adapter = [System.Data.Odbc.OdbcDataAdapter]::new("SELECT * FROM [System] WHERE [Number] = $number", $connection)
    $table = [System.Data.DataTable]::new()
    [void]$adapter.Fill($table)
    $adapter.Dispose()
    if ($table.Rows.Count -ne 1) { throw "Expected exactly 1 System row with Number=$number, found $($table.Rows.Count)" }
    # Comma wrapper: PowerShell unrolls a returned DataTable into its DataRows.
    return ,$table
}

try {
    $connection.Open()

    "== schema =="
    $columns = @($connection.GetSchema('Columns') | Where-Object TABLE_NAME -eq 'System' |
        Sort-Object ORDINAL_POSITION)
    "System columns: $($columns.Count)"
    "Identifier type: $(($columns | Where-Object COLUMN_NAME -eq 'Identifier').TYPE_NAME)"
    "Number type:     $(($columns | Where-Object COLUMN_NAME -eq 'Number').TYPE_NAME)"
    "Description type:$(($columns | Where-Object COLUMN_NAME -eq 'Description').TYPE_NAME)"
    $tables = @($connection.GetSchema('Tables') | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } | ForEach-Object TABLE_NAME)
    "DefaultSystem table present: $($tables -contains 'DefaultSystem')"

    $censusBefore = Get-Census $connection
    "== census before ==";  $censusBefore.Keys | ForEach-Object { "$_`t$($censusBefore[$_])" }

    $sourceTable = Get-SystemRow $connection $CloneFrom
    $sourceRow = $sourceTable.Rows[0]
    "== source row (Number=$CloneFrom) =="
    "Identifier=$($sourceRow['Identifier'])  Description='$($sourceRow['Description'])'"

    # Clone every column except the COUNTER (Identifier) and the two we deliberately own.
    $cloned = @($columns | ForEach-Object COLUMN_NAME |
        Where-Object { $_ -notin @('Identifier', 'Number', 'Description') })
    $quoted = ($cloned | ForEach-Object { "[$_]" }) -join ', '
    "cloned columns: $($cloned.Count)  (skipped: Identifier, Number, Description)"

    $insert = $connection.CreateCommand()
    $insert.CommandText = "INSERT INTO [System] ([Number], [Description], $quoted) SELECT ?, ?, $quoted FROM [System] WHERE [Number] = $CloneFrom"
    [void]$insert.Parameters.Add('@number', [System.Data.Odbc.OdbcType]::Int)
    [void]$insert.Parameters.Add('@description', [System.Data.Odbc.OdbcType]::VarChar, 255)
    $insert.Parameters[0].Value = $NewNumber
    $insert.Parameters[1].Value = $NewName
    $affected = $insert.ExecuteNonQuery()
    $insert.Dispose()
    "== insert == affected rows = $affected"

    $newTable = Get-SystemRow $connection $NewNumber
    $newRow = $newTable.Rows[0]
    "new row Identifier=$($newRow['Identifier'])  Number=$($newRow['Number'])  Description='$($newRow['Description'])'"

    "== column-by-column diff (new vs cloned source) =="
    $differences = 0
    foreach ($column in $sourceTable.Columns) {
        $before = Format-Value $sourceRow[$column.ColumnName]
        $after = Format-Value $newRow[$column.ColumnName]
        if ($before -ne $after) {
            $differences++
            "DIFF $($column.ColumnName): '$before' -> '$after'"
        }
    }
    "columns differing: $differences of $($sourceTable.Columns.Count)"

    $censusAfter = Get-Census $connection
    "== census after =="
    foreach ($table in $censusBefore.Keys) {
        $delta = $censusAfter[$table] - $censusBefore[$table]
        if ($delta -ne 0) { "CHANGED $table`t$($censusBefore[$table]) -> $($censusAfter[$table])" }
    }

    "== duplicate-Number probe =="
    try {
        $duplicate = $connection.CreateCommand()
        $duplicate.CommandText = "INSERT INTO [System] ([Number], [Description], $quoted) SELECT $NewNumber, 'DUPLICATE', $quoted FROM [System] WHERE [Number] = $CloneFrom"
        [void]$duplicate.ExecuteNonQuery()
        $duplicate.Dispose()
        'DUPLICATE ACCEPTED -- System.Number is NOT unique-indexed'
    } catch {
        "DUPLICATE REFUSED: $($_.Exception.Message.Trim())"
    }
} finally {
    $connection.Dispose()
}
