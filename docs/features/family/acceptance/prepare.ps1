param(
    [Parameter(Mandatory = $true)][string]$FamilyDocument,
    [Parameter(Mandatory = $true)][string]$ProjectDocument,
    [Parameter(Mandatory = $true)][string]$SessionId,
    [string]$SourceFixture,
    [switch]$ParametersOnly,
    [string]$RunName = (Get-Date -Format 'yyyyMMdd-HHmmss')
)
$ErrorActionPreference = 'Stop'
# This writes request files only. The proof owner supplies and operates the Revit session.
if ($SessionId -eq 'pe.app-25') { throw 'pe.app-25 is outside this proof lane.' }
if ($RunName -notmatch '^[a-zA-Z0-9._-]+$') { throw 'RunName must be a filename segment.' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$output = Join-Path $repoRoot ".artifacts/runs/ff-route-acceptance/$RunName"
$fixture = if ($SourceFixture) { (Resolve-Path -LiteralPath $SourceFixture).Path } else { Join-Path $repoRoot 'dotnet/Pe.Revit.Tests/Fixtures/FamilyModel/a-box.family.json' }
$model = Get-Content -LiteralPath $fixture -Raw | ConvertFrom-Json
if ($model.datums.'Ref. Level'.normal -ne 'Z' -or $model.parameters.Voltage.value -ne '480 V') {
    throw 'Use the integrated canonical Box fixture (unsigned datums and explicit Voltage units).'
}
$patch = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'parameters.patch.json') -Raw | ConvertFrom-Json
foreach ($parameter in $patch.patch.parameters.PSObject.Properties) {
    $model.parameters | Add-Member -MemberType NoteProperty -Name $parameter.Name -Value $parameter.Value -Force
}
if ($ParametersOnly) {
    $model = [ordered]@{ family = $model.family; parameters = $patch.patch.parameters }
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
function Write-Request([string]$Name, $Value) {
    $json = $Value | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText((Join-Path $output $Name), $json, [Text.UTF8Encoding]::new($false))
}
Write-Request 'model.json' $model
Write-Request 'patch.json' $patch
foreach ($route in @('family', 'families')) {
    $isFamily = $route -eq 'family'
    $document = if ($isFamily) { $FamilyDocument } else { $ProjectDocument }
    $rootKey = if ($isFamily) { 'models' } else { 'patches' }
    $documentId = @{ moduleKey = 'FamilyFoundry'; rootKey = $rootKey; relativePath = "ff-route-proof-$RunName" }
    $content = if ($isFamily) { $model } else { $patch }
    Write-Request "$route-scope.json" @{ kind = 'document'; document = $document; pin = $SessionId }
    Write-Request "$route-create.pe-do.json" @{ key = 'route:settings.create'; input = @{ documentId = $documentId; rawContent = ($content | ConvertTo-Json -Depth 100) }; timeoutSeconds = 300 }
    $plan = if ($isFamily) { @{ documentId = $documentId } } else {
        @{ profilePath = $documentId.relativePath; scope = @{ categoryNames = @('ElectricalEquipment'); familyNames = @('PE Box'); placementScope = 'AllLoaded' } }
    }
    Write-Request "$route-plan.pe-do.json" @{ key = "route:$route.plan"; input = $plan; timeoutSeconds = 300 }
    Write-Request "$route-read.pe-read.json" @{ key = "route:$route"; timeoutSeconds = 300 }
    Write-Request "$route-url.json" @{ url = "/$($route)?doc=$([uri]::EscapeDataString($document))&target=$([uri]::EscapeDataString($SessionId))" }
}
Write-Request 'expected.json' @{
    sourceFixture = $fixture; sourceSha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
    parametersOnly = [bool]$ParametersOnly
    familyName = 'PE Box'; width = '42in'; sharedCount = 7
    sharedGuid = $patch.patch.parameters.FF_Route_Proof_Count.sharedGuid
    sharedSpecId = $patch.patch.parameters.FF_Route_Proof_Count.sharedSpecId
    receipt = @{ success = $true; converged = $true; residueCount = 0; errorCount = 0 }
    captureRequirements = @('parameters coverage reported', 'native shared definition retained', 'Width equivalent to 42in', 'FF_Route_Proof_Count equals 7')
}
Write-Output $output
