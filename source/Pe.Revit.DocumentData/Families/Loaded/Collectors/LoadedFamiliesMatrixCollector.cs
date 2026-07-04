using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.DocumentData.Families.Loaded.Models;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Serilog;

namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

public static class LoadedFamiliesMatrixCollector {
    public static LoadedFamiliesMatrixData Collect(
        Document doc,
        LoadedFamiliesFilter? filter = null,
        Action<string>? onProgress = null,
        RevitDataOutputBudget? budget = null,
        bool includeTempPlacement = true
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

        // Phase 1: one extractor pass per family (EditFamily reuse + FamilyType.As* reads; formulas,
        // authored per-type values, and classification metadata in a single family-doc open). Must run
        // outside any transaction — EditFamily throws inside one.
        var extractStopwatch = Stopwatch.StartNew();
        onProgress?.Invoke($"Family matrix extracting family-doc truth for {catalogFamilies.Count} families.");
        var snapshotRecords = new Dictionary<long, FamilySnapshotRecord>();
        foreach (var familyId in selectedFamilyIds) {
            if (doc.GetElement(familyId.ToElementId()) is not Family familyElement)
                continue;

            var familyStopwatch = Stopwatch.StartNew();
            var record = FamilySnapshotExtractor.ExtractFromProjectFamily(doc, familyElement);
            snapshotRecords[familyId] = record;
            onProgress?.Invoke(
                $"Family matrix extracted '{record.FamilyName}' in {familyStopwatch.Elapsed.TotalMilliseconds:F0} ms."
            );
        }

        var extractElapsed = extractStopwatch.Elapsed;
        onProgress?.Invoke($"Family matrix finished family-doc extraction in {extractElapsed.TotalMilliseconds:F0} ms.");

        // Phase 2: one temp-placement sandbox pass serving BOTH project values and schedule matching
        // (the old flow placed twice because EditFamily had to run between the two transactions).
        // With placement disabled the same collector still gathers type parameters from symbols.
        var projectValueStopwatch = Stopwatch.StartNew();
        List<CollectedLoadedFamilyRecord> projectValueFamilies;
        List<CollectedLoadedFamilyRecord> scheduleFamilies;
        var projectPlacementAttempts = 0;
        var projectPlacementSuccesses = 0;
        var candidateSchedules = 0;
        var scheduleSerializeElapsed = TimeSpan.Zero;
        var scheduleEvalElapsed = TimeSpan.Zero;
        TimeSpan projectValueElapsed;
        TimeSpan scheduleMatchElapsed;
        using (var evaluationContext = LoadedFamiliesTempPlacementEngine.CreateEvaluationContext(doc, selectedFamilyIds)) {
            onProgress?.Invoke($"Family matrix collecting project values for {catalogFamilies.Count} families.");
            if (includeTempPlacement)
                evaluationContext.BeginTransaction("Loaded Families Matrix Evaluation");

            try {
                if (includeTempPlacement)
                    LoadedFamiliesTempPlacementEngine.PlaceOneTempInstancePerPlaceableSymbol(evaluationContext);

                var collectedFamilies = ProjectLoadedFamilyCollector.CollectFromPlacedInstances(
                    evaluationContext,
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
                projectPlacementAttempts = evaluationContext.PlacementAttempts;
                projectPlacementSuccesses = evaluationContext.PlacementSuccesses;
                projectValueElapsed = projectValueStopwatch.Elapsed;
                onProgress?.Invoke(
                    $"Family matrix finished project value collection in {projectValueElapsed.TotalMilliseconds:F0} ms. Placed {projectPlacementSuccesses} of {projectPlacementAttempts} temp instances."
                );

                var scheduleMatchStopwatch = Stopwatch.StartNew();
                if (includeTempPlacement) {
                    onProgress?.Invoke("Family matrix matching schedules.");
                    scheduleFamilies = LoadedFamiliesScheduleCollector.Supplement(
                        doc,
                        projectValueFamilies,
                        evaluationContext,
                        (schedule, serializeElapsed, evaluateElapsed, matchCount) => {
                            candidateSchedules++;
                            scheduleSerializeElapsed += serializeElapsed;
                            scheduleEvalElapsed += evaluateElapsed;
                            onProgress?.Invoke(
                                $"Family matrix evaluated schedule '{schedule.Name}' in {(serializeElapsed + evaluateElapsed).TotalMilliseconds:F0} ms. Matches={matchCount}."
                            );
                        }
                    );
                } else
                    scheduleFamilies = projectValueFamilies;
                scheduleMatchElapsed = scheduleMatchStopwatch.Elapsed;
            } finally {
                evaluationContext.RollBackTransaction();
            }
        }

        onProgress?.Invoke(
            $"Family matrix finished schedule matching in {scheduleMatchElapsed.TotalMilliseconds:F0} ms across {candidateSchedules} schedules."
        );

        // Phase 3: pure-compute authority classification + formula supplement from the extracted records.
        var formulaStopwatch = Stopwatch.StartNew();
        onProgress?.Invoke($"Family matrix classifying parameters for {scheduleFamilies.Count} families.");
        var supplementedFamilies = LoadedFamiliesFormulaCollector.Supplement(
            doc,
            scheduleFamilies,
            snapshotRecords,
            (familyName, elapsed) => onProgress?.Invoke(
                $"Family matrix supplemented formulas for '{familyName}' in {elapsed.TotalMilliseconds:F0} ms."
            )
        );
        var formulaElapsed = formulaStopwatch.Elapsed;
        onProgress?.Invoke($"Family matrix finished classification in {formulaElapsed.TotalMilliseconds:F0} ms.");

        Log.Information(
            "Loaded families matrix timings: TotalMs={TotalMs}, CatalogCollectMs={CatalogCollectMs}, FamilyDocExtractMs={FamilyDocExtractMs}, PlacementPhaseProjectValuesMs={PlacementPhaseProjectValuesMs}, FormulaCollectMs={FormulaCollectMs}, PlacementPhaseScheduleMatchMs={PlacementPhaseScheduleMatchMs}, ScheduleSerializeMs={ScheduleSerializeMs}, ScheduleEvalMs={ScheduleEvalMs}, TotalFamilies={TotalFamilies}, TotalSymbols={TotalSymbols}, ProjectPlacementAttempts={ProjectPlacementAttempts}, ProjectPlacedTempInstances={ProjectPlacedTempInstances}, CandidateSchedules={CandidateSchedules}, IncludeTempPlacement={IncludeTempPlacement}",
            totalStopwatch.ElapsedMilliseconds,
            (long)catalogElapsed.TotalMilliseconds,
            (long)extractElapsed.TotalMilliseconds,
            (long)projectValueElapsed.TotalMilliseconds,
            (long)formulaElapsed.TotalMilliseconds,
            (long)scheduleMatchElapsed.TotalMilliseconds,
            (long)scheduleSerializeElapsed.TotalMilliseconds,
            (long)scheduleEvalElapsed.TotalMilliseconds,
            supplementedFamilies.Count,
            catalogFamilies.Sum(family => family.Types.Count),
            projectPlacementAttempts,
            projectPlacementSuccesses,
            candidateSchedules,
            includeTempPlacement
        );
        onProgress?.Invoke(
            $"Family matrix completed in {totalStopwatch.Elapsed.TotalMilliseconds:F0} ms."
        );

        var maxFamilies = effectiveBudget.MaxEntries;
        var matrixFamilies = maxFamilies is > 0
            ? supplementedFamilies.Take(maxFamilies.Value).ToList()
            : supplementedFamilies;
        var issues = supplementedFamilies.SelectMany(family => family.Issues)
            .Select(LoadedFamiliesCollectorSupport.ToContractIssue)
            .Distinct()
            .ToList();
        if (maxFamilies is > 0 && supplementedFamilies.Count > maxFamilies.Value) {
            issues.Add(new RevitDataIssue(
                "LoadedFamiliesMatrixTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {matrixFamilies.Count} of {supplementedFamilies.Count} matching loaded familie(s). Increase budget.maxEntries to expand."
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
            new RevitDataResultPage(supplementedFamilies.Count, matrixFamilies.Count, maxFamilies is > 0 && supplementedFamilies.Count > maxFamilies.Value)
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
            .OrderBy(parameter => parameter.Definition.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.Definition.IsInstance)
            .AsEnumerable();
        var excludedParameters = family.Parameters
            .Where(parameter => parameter.ExcludedReason != null)
            .Select(ToExcludedParameter)
            .OrderBy(parameter => parameter.Definition.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(parameter => parameter.Definition.IsInstance)
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
            ToDefinition(parameter),
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterPresence(parameter.Scope),
            parameter.StorageType,
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula,
            (maxSamplesPerEntry is > 0
                ? parameter.ValuesByType.Take(maxSamplesPerEntry.Value)
                : parameter.ValuesByType)
            .ToDictionary(pair => pair.Key, pair => (string?)pair.Value, StringComparer.Ordinal)
        );

    private static LoadedFamilyExcludedParameterEntry ToExcludedParameter(CollectedFamilyParameterRecord parameter) =>
        new(
            ToDefinition(parameter),
            LoadedFamiliesCollectorSupport.ToContractParameterKind(parameter.Kind),
            LoadedFamiliesCollectorSupport.ToContractParameterPresence(parameter.Scope),
            LoadedFamiliesCollectorSupport.ToContractExcludedReason(
                parameter.ExcludedReason ?? CollectedExcludedParameterReason.UnresolvedClassification
            ),
            LoadedFamiliesCollectorSupport.ToContractFormulaState(parameter.FormulaState),
            parameter.Formula
        );

    private static ParameterDefinitionDescriptor ToDefinition(CollectedFamilyParameterRecord parameter) =>
        new(
            ParameterIdentityEngine.FromCanonical(parameter.Identity),
            parameter.IsInstance,
            parameter.DataTypeId,
            parameter.DataTypeLabel,
            parameter.GroupTypeId,
            parameter.GroupTypeLabel
        );
}
