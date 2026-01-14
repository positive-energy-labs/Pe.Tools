# Build script that filters and displays only nullable reference type warnings
# Usage: .\build-nullable-check.ps1 [project-path]

param(
    [string]$ProjectPath = "source\Pe.Global\Pe.Global.csproj"
)

Write-Host "Building $ProjectPath with nullable warnings filter..." -ForegroundColor Cyan
Write-Host ""

$output = dotnet build $ProjectPath /p:RevitVersion=2025 2>&1 | Out-String

# Extract nullable warnings
$nullableWarnings = $output | Select-String "warning CS86\d\d" -AllMatches

if ($nullableWarnings) {
    $count = ($nullableWarnings | Measure-Object).Count
    Write-Host "Found $count nullable warnings:" -ForegroundColor Yellow
    Write-Host ""
    $nullableWarnings | ForEach-Object { Write-Host $_.Line }
    
    # Summary by type
    Write-Host ""
    Write-Host "Summary by warning type:" -ForegroundColor Cyan
    $nullableWarnings | ForEach-Object { 
        if ($_.Line -match "warning (CS86\d\d)") { $matches[1] } 
    } | Group-Object | Sort-Object Count -Descending | Format-Table Name, Count -AutoSize
} else {
    Write-Host "No nullable warnings found!" -ForegroundColor Green
}

# Show build result
if ($output -match "Build FAILED") {
    Write-Host ""
    Write-Host "Build FAILED" -ForegroundColor Red
    exit 1
} elseif ($output -match "Build succeeded") {
    Write-Host ""
    Write-Host "Build succeeded" -ForegroundColor Green
    exit 0
}
