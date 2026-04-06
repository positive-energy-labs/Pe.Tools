using Pe.Shared.HostContracts.RevitData;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Shared.RevitData.Families;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesMatrixCollector {
    public static LoadedFamiliesMatrixData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null,
        Action<string>? onProgress = null
    ) {
        var totalStopwatch = Stopwatch.StartNew();

        var catalogStopwatch = Stopwatch.StartNew();
        var catalogFamilies = LoadedFamiliesCatalogCollector.CollectCanonical(doc, filter);
        var catalogElapsed = catalogStopwatch.Elapsed;
        onProgress?.Invoke(
            $"Family matrix collected catalog for {catalogFamilies.Count} families in {catalogElapsed.TotalMilliseconds:F0} ms."
        );

        var selectedFamilyIds = catalogFamilies
            .Select(family => family.FamilyId)
            .ToHashSet();

        var projectValueStopwatch = Stopwatch.StartNew();
        List<CollectedLoadedFamilyRecord> projectValueFamilies;
        int projectPlacementAttempts = 0;
        int projectPlacementSuccesses = 0;
        using (var projectContext = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(doc, selectedFamilyIds)) {
            onProgress?.Invoke($"Family matrix collecting project values for {catalogFamilies.Count} families.");
            projectContext.BeginTransaction("Loaded Families Matrix Project Values");

            try {
                LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(projectContext);
                var collectedFamilies = ProjectLoadedFamilyCollector.CollectFromPlacedInstances(
                    projectContext,
                    (familyRecord, elapsed) => onProgress?.Invoke(
                        $"Family matrix collected '{familyRecord.FamilyName}' in {elapsed.TotalMilliseconds:F0} ms."
                    )
                );
                var mappedFamilies = collectedFamilies
                    .Select(LoadedFamiliesCollectorSupport.MapProjectFamily)
                    .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                projectValueFamilies = LoadedFamiliesProjectValueCollector.MergeCatalogMetadata(
                    catalogFamilies,
                    mappedFamilies
                );
                projectPlacementAttempts = projectContext.PlacementAttempts;
                projectPlacementSuccesses = projectContext.PlacementSuccesses;
            } finally {
                projectContext.RollBackTransaction();
            }
        }
        var projectValueElapsed = projectValueStopwatch.Elapsed;
        onProgress?.Invoke(
            $"Family matrix finished project value collection in {projectValueElapsed.TotalMilliseconds:F0} ms. Placed {projectPlacementSuccesses} of {projectPlacementAttempts} temp instances."
        );

        var formulaStopwatch = Stopwatch.StartNew();
        onProgress?.Invoke($"Family matrix collecting formulas for {projectValueFamilies.Count} families.");
        var supplementedFamilies = LoadedFamiliesFormulaCollector.Supplement(
            doc,
            projectValueFamilies,
            (familyName, elapsed) => onProgress?.Invoke(
                $"Family matrix supplemented formulas for '{familyName}' in {elapsed.TotalMilliseconds:F0} ms."
            )
        );
        var formulaElapsed = formulaStopwatch.Elapsed;
        onProgress?.Invoke($"Family matrix finished formula collection in {formulaElapsed.TotalMilliseconds:F0} ms.");

        var scheduleMatchStopwatch = Stopwatch.StartNew();
        List<CollectedLoadedFamilyRecord> scheduleFamilies;
        int schedulePlacementAttempts = 0;
        int schedulePlacementSuccesses = 0;
        var candidateSchedules = 0;
        var scheduleSerializeElapsed = TimeSpan.Zero;
        var scheduleEvalElapsed = TimeSpan.Zero;
        using (var scheduleContext = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(doc, selectedFamilyIds)) {
            onProgress?.Invoke("Family matrix matching schedules.");
            scheduleContext.BeginTransaction("Loaded Families Matrix Schedule Matching");

            try {
                LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(scheduleContext);
                schedulePlacementAttempts = scheduleContext.PlacementAttempts;
                schedulePlacementSuccesses = scheduleContext.PlacementSuccesses;
                scheduleFamilies = LoadedFamiliesScheduleCollector.Supplement(
                    doc,
                    supplementedFamilies,
                    scheduleContext,
                    (schedule, serializeElapsed, evaluateElapsed, matchCount) => {
                        candidateSchedules++;
                        scheduleSerializeElapsed += serializeElapsed;
                        scheduleEvalElapsed += evaluateElapsed;
                        onProgress?.Invoke(
                            $"Family matrix evaluated schedule '{schedule.Name}' in {(serializeElapsed + evaluateElapsed).TotalMilliseconds:F0} ms. Matches={matchCount}."
                        );
                    }
                );
            } finally {
                scheduleContext.RollBackTransaction();
            }
        }
        var scheduleMatchElapsed = scheduleMatchStopwatch.Elapsed;
        onProgress?.Invoke(
            $"Family matrix finished schedule matching in {scheduleMatchElapsed.TotalMilliseconds:F0} ms across {candidateSchedules} schedules. Placed {schedulePlacementSuccesses} of {schedulePlacementAttempts} temp instances."
        );

        Log.Information(
            "Loaded families matrix timings: TotalMs={TotalMs}, CatalogCollectMs={CatalogCollectMs}, PlacementPhaseProjectValuesMs={PlacementPhaseProjectValuesMs}, FormulaCollectMs={FormulaCollectMs}, PlacementPhaseScheduleMatchMs={PlacementPhaseScheduleMatchMs}, ScheduleSerializeMs={ScheduleSerializeMs}, ScheduleEvalMs={ScheduleEvalMs}, TotalFamilies={TotalFamilies}, TotalSymbols={TotalSymbols}, ProjectPlacementAttempts={ProjectPlacementAttempts}, ProjectPlacedTempInstances={ProjectPlacedTempInstances}, SchedulePlacementAttempts={SchedulePlacementAttempts}, SchedulePlacedTempInstances={SchedulePlacedTempInstances}, CandidateSchedules={CandidateSchedules}",
            totalStopwatch.ElapsedMilliseconds,
            (long)catalogElapsed.TotalMilliseconds,
            (long)projectValueElapsed.TotalMilliseconds,
            (long)formulaElapsed.TotalMilliseconds,
            (long)scheduleMatchElapsed.TotalMilliseconds,
            (long)scheduleSerializeElapsed.TotalMilliseconds,
            (long)scheduleEvalElapsed.TotalMilliseconds,
            supplementedFamilies.Count,
            catalogFamilies.Sum(family => family.Types.Count),
            projectPlacementAttempts,
            projectPlacementSuccesses,
            schedulePlacementAttempts,
            schedulePlacementSuccesses,
            candidateSchedules
        );
        onProgress?.Invoke(
            $"Family matrix completed in {totalStopwatch.Elapsed.TotalMilliseconds:F0} ms."
        );

        return new LoadedFamiliesMatrixData(
            scheduleFamilies.Select(ToMatrixFamily).ToList(),
            scheduleFamilies.SelectMany(family => family.Issues)
                .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
                .Distinct()
                .ToList()
        );
    }

    private static LoadedFamilyMatrixFamily ToMatrixFamily(CollectedLoadedFamilyRecord family) =>
        new(
            family.FamilyId,
            family.FamilyUniqueId,
            family.FamilyName,
            family.CategoryName,
            family.PlacedInstanceCount,
            family.Types.Select(type => new LoadedFamilyTypeEntry(type.TypeName)).ToList(),
            family.ScheduleNames.ToList(),
            family.Parameters
                .Where(LoadedFamiliesCollectorSupport.IsVisibleInMatrix)
                .Select(ToVisibleParameter)
                .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList(),
            family.Parameters
                .Where(parameter => parameter.ExcludedReason != null)
                .Select(ToExcludedParameter)
                .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList(),
            family.Issues.Select(LoadedFamiliesCollectorSupport.ToContractIssue).ToList()
        );

    private static LoadedFamilyVisibleParameterEntry ToVisibleParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterScope(parameter.Scope),
            parameter.StorageType,
            parameter.DataTypeId,
            parameter.DataTypeLabel,
            parameter.GroupTypeId,
            parameter.GroupTypeLabel,
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula,
            new Dictionary<string, string?>(parameter.ValuesByType, StringComparer.Ordinal)
        );

    private static LoadedFamilyExcludedParameterEntry ToExcludedParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterScope(parameter.Scope),
            LoadedFamiliesCollectorSupport.ToContractExcludedReason(
                parameter.ExcludedReason ?? CollectedExcludedParameterReason.UnresolvedClassification
            ),
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula
        );
}
