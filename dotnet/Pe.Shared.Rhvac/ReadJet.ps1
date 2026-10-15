param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
if([IntPtr]::Size -ne 4){throw 'Jet reader requires a 32-bit process.'}
Add-Type -AssemblyName System.Data
$builder = New-Object System.Data.Odbc.OdbcConnectionStringBuilder
$builder['Driver']='Microsoft Access Driver (*.mdb)'
$builder['Dbq']=[IO.Path]::GetFullPath($InputPath)
$builder['ReadOnly']='1'; $builder['Uid']='Admin'; $builder['Pwd']=''
$connection=New-Object System.Data.Odbc.OdbcConnection($builder.ConnectionString)
try {
 $connection.Open(); $tables=[ordered]@{}
 foreach($schemaRow in $connection.GetSchema('Tables').Rows){
  if($schemaRow.TABLE_TYPE -ne 'TABLE'){continue}
  $name=[string]$schemaRow.TABLE_NAME
  $data=New-Object System.Data.DataTable
  $adapter=New-Object System.Data.Odbc.OdbcDataAdapter(('SELECT * FROM ['+$name.Replace(']',']]')+']'),$connection)
  try{[void]$adapter.Fill($data)}finally{$adapter.Dispose()}
  $columns=@(foreach($col in $data.Columns){[ordered]@{name=$col.ColumnName;type=$col.DataType.FullName;nullable=$col.AllowDBNull}})
  $rows=@(foreach($r in $data.Rows){
   $row=[ordered]@{}
   foreach($col in $data.Columns){
    $v=$r[$col]
    if($v -is [DBNull]){$v=$null}
    elseif($v -is [byte[]]){$v=[ordered]@{binary=[Convert]::ToBase64String($v)}}
    elseif($v -is [DateTime]){$v=$v.ToString('o')}
    elseif($v -is [single] -or $v -is [double]){
     if([double]::IsNaN($v)){$v=[ordered]@{'$number'='NaN'}}
     elseif([double]::IsPositiveInfinity($v)){$v=[ordered]@{'$number'='+Infinity'}}
     elseif([double]::IsNegativeInfinity($v)){$v=[ordered]@{'$number'='-Infinity'}}
     else{$v=[double]$v}
    }
    $row[$col.ColumnName]=$v
   }
   $row
  })
  $tables[$name]=[ordered]@{columns=$columns;rows=$rows}
 }
 [IO.File]::WriteAllText($OutputPath,($tables | ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
}finally{$connection.Dispose()}
