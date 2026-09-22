using Pe.Shared.RevitVersions;
using System.IO;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationProcessingRouteService {
    public const int MinimumDirectCloudYear = 2024;
    public const int LegacyExecutionYear = 2024;
    public const int MinimumSupportedSourceYear = 2020;

    public ResolvedAutomationProcessingRoute ResolveRoute(
        ScheduleAuditManifestEntry manifestEntry,
        ModelResolutionResult resolvedModel
    ) {
        var sourceYear = resolvedModel.RevitYear;
        var yearResolutionSource = AutomationManifestYearResolutionSource.Aps;

        if (sourceYear.HasValue) {
            if (manifestEntry.RevitYearHint.HasValue && manifestEntry.RevitYearHint.Value != sourceYear.Value) {
                throw new InvalidDataException(
                    $"Resolved model '{resolvedModel.ModelPath}' APS revitYear '{sourceYear.Value}' conflicts with manifest revitYearHint '{manifestEntry.RevitYearHint.Value}'.");
            }
        } else if (manifestEntry.RevitYearHint.HasValue) {
            sourceYear = manifestEntry.RevitYearHint.Value;
            yearResolutionSource = AutomationManifestYearResolutionSource.ManifestHint;
        } else
            throw new InvalidDataException(
                $"Resolved model '{resolvedModel.ModelPath}' did not include APS revitProjectVersion metadata. Add `revitYearHint` to the manifest entry.");

        if (sourceYear.Value < MinimumSupportedSourceYear) {
            throw new InvalidDataException(
                $"Resolved model '{resolvedModel.ModelPath}' source revitYear '{sourceYear.Value}' is below the supported minimum {MinimumSupportedSourceYear}.");
        }

        var processingMode = sourceYear.Value >= MinimumDirectCloudYear
            ? AutomationProcessingMode.DirectCloud
            : AutomationProcessingMode.TransientLocalUpgrade;
        var executionYear = processingMode == AutomationProcessingMode.DirectCloud
            ? sourceYear.Value
            : LegacyExecutionYear;
        var executionSpec = RevitVersionCatalog.RequireByYear(executionYear);

        return new ResolvedAutomationProcessingRoute {
            SourceRevitYear = sourceYear.Value,
            ExecutionRevitYear = executionSpec.Year,
            ProcessingMode = processingMode,
            YearResolutionSource = yearResolutionSource,
            FallbackReason = processingMode == AutomationProcessingMode.TransientLocalUpgrade
                ? $"Source model year {sourceYear.Value} is below direct-cloud minimum {MinimumDirectCloudYear}. Routing through transient local upgrade in Revit {executionSpec.Year}."
                : null
        };
    }
}

internal sealed class ResolvedAutomationProcessingRoute {
    public int SourceRevitYear { get; init; }
    public int ExecutionRevitYear { get; init; }
    public AutomationProcessingMode ProcessingMode { get; init; }
    public AutomationManifestYearResolutionSource YearResolutionSource { get; init; }
    public string? FallbackReason { get; init; }
}
