using Pe.Revit.DocumentData.Families.Loaded.Models;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;
using Serilog;

namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

public static class LoadedFamiliesMatrixCollector {
    public static LoadedFamiliesMatrixData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null,
        Action<string>? onProgress = null,
        RevitDataOutputBudget? budget = null
    ) {
        var effectiveBudget = RevitDataOutputBudgets.WithDefaults(budget, maxEntries: 10, maxSamplesPerEntry: 25);
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
        var projectPlacementAttempts = 0;
        var projectPlacementSuccesses = 0;
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
        var schedulePlacementAttempts = 0;
        var schedulePlacementSuccesses = 0;
        var candidateSchedules = 0;
        var scheduleSerializeElapsed = TimeSpan.Zero;
        var scheduleEvalElapsed = TimeSpan.Zero;
        using (var scheduleContext =
               LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(doc, selectedFamilyIds)) {
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

        var maxFamilies = effectiveBudget.MaxEntries;
        var matrixFamilies = maxFamilies is > 0
            ? scheduleFamilies.Take(maxFamilies.Value).ToList()
            : scheduleFamilies;
        var issues = scheduleFamilies.SelectMany(family => family.Issues)
            .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
            .Distinct()
            .ToList();
        if (maxFamilies is > 0 && scheduleFamilies.Count > maxFamilies.Value) {
            issues.Add(new RevitDataIssue(
                "LoadedFamiliesMatrixTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {matrixFamilies.Count} of {scheduleFamilies.Count} matching loaded familie(s). Increase budget.maxEntries to expand."
            ));
        }

        if (matrixFamilies.Any(family => HasChildTruncation(family, effectiveBudget.MaxSamplesPerEntry))) {
            issues.Add(new RevitDataIssue(
                "LoadedFamiliesMatrixSamplesTruncated",
                RevitDataIssueSeverity.Warning,
                "Loaded-family matrix child collections were truncated by budget.maxSamplesPerEntry. Increase the sample budget or narrow the filter to expand."
            ));
        }

        return new LoadedFamiliesMatrixData(
            matrixFamilies.Select(family => ToMatrixFamily(family, effectiveBudget.MaxSamplesPerEntry)).ToList(),
            RevitDataOutputBudgets.ProjectIssues(issues, effectiveBudget),
            new RevitDataResultPage(scheduleFamilies.Count, matrixFamilies.Count, maxFamilies is > 0 && scheduleFamilies.Count > maxFamilies.Value)
        );
    }

    private static bool HasChildTruncation(CollectedLoadedFamilyRecord family, int? maxSamplesPerEntry) {
        if (maxSamplesPerEntry is not > 0)
            return false;
        return family.Types.Count > maxSamplesPerEntry.Value
               || family.ScheduleNames.Count > maxSamplesPerEntry.Value
               || family.Parameters.Count(LoadedFamiliesCollectorSupport.IsVisibleInMatrix) > maxSamplesPerEntry.Value
               || family.Parameters.Count(parameter => parameter.ExcludedReason != null) > maxSamplesPerEntry.Value
               || family.Parameters.Any(parameter => parameter.ValuesByType.Count > maxSamplesPerEntry.Value);
    }

    private static LoadedFamilyMatrixFamily ToMatrixFamily(CollectedLoadedFamilyRecord family, int? maxSamplesPerEntry) {
        var visibleParameters = family.Parameters
            .Where(LoadedFamiliesCollectorSupport.IsVisibleInMatrix)
            .Select(parameter => ToVisibleParameter(parameter, maxSamplesPerEntry))
            .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
            .AsEnumerable();
        var excludedParameters = family.Parameters
            .Where(parameter => parameter.ExcludedReason != null)
            .Select(ToExcludedParameter)
            .OrderBy(parameter => parameter.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.IsInstance)
            .AsEnumerable();
        var types = family.Types.Select(type => new LoadedFamilyTypeEntry(type.TypeName)).AsEnumerable();
        var scheduleNames = family.ScheduleNames.AsEnumerable();
        if (maxSamplesPerEntry is > 0) {
            types = types.Take(maxSamplesPerEntry.Value);
            scheduleNames = scheduleNames.Take(maxSamplesPerEntry.Value);
            visibleParameters = visibleParameters.Take(maxSamplesPerEntry.Value);
            excludedParameters = excludedParameters.Take(maxSamplesPerEntry.Value);
        }

        return new LoadedFamilyMatrixFamily(
            family.FamilyId,
            family.FamilyUniqueId,
            family.FamilyName,
            family.CategoryName,
            family.PlacedInstanceCount,
            types.ToList(),
            scheduleNames.ToList(),
            visibleParameters.ToList(),
            excludedParameters.ToList(),
            family.Issues.Select(LoadedFamiliesCollectorSupport.ToContractIssue).ToList()
        );
    }

    private static LoadedFamilyVisibleParameterEntry ToVisibleParameter(CollectedFamilyParameterRecord parameter, int? maxSamplesPerEntry) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterPresence(parameter.Scope),
            parameter.StorageType,
            parameter.DataTypeId,
            parameter.DataTypeLabel,
            parameter.GroupTypeId,
            parameter.GroupTypeLabel,
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula,
            new Dictionary<string, string?>(
                maxSamplesPerEntry is > 0
                    ? parameter.ValuesByType.Take(maxSamplesPerEntry.Value)
                    : parameter.ValuesByType,
                StringComparer.Ordinal
            )
        );

    private static LoadedFamilyExcludedParameterEntry ToExcludedParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterPresence(parameter.Scope),
            LoadedFamiliesCollectorSupport.ToContractExcludedReason(
                parameter.ExcludedReason ?? CollectedExcludedParameterReason.UnresolvedClassification
            ),
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula
        );
}
