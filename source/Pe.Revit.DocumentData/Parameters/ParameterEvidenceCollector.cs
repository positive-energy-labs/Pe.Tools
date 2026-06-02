using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Shared.RevitData;
using Serilog;
using System.Text.RegularExpressions;

namespace Pe.Revit.DocumentData.Parameters;

public static class ParameterEvidenceCollector {
    public static ParameterEvidencePrimitiveSet CollectPrimitives(Document doc) {
        var collectedAt = DateTimeOffset.UtcNow;
        var bindings = ProjectParameterBindingsCollector.Collect(
                doc,
                projection: new RevitDataProjectionRequest { View = RevitDataResultView.Rows },
                budget: new RevitDataOutputBudget { MaxEntries = 500, IncludeDiagnostics = false }
            )
            .Entries
            .Select(entry => new ParameterProjectBindingEvidence(
                entry.Definition,
                entry.BindingKind,
                entry.CategoryNames
            ))
            .ToList();

        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .ToList();
        var scheduleFields = new List<ParameterScheduleFieldEvidence>();
        foreach (var schedule in schedules) {
            try {
                scheduleFields.AddRange(ScheduleCollectorSupport.CollectParameterEvidenceFields(doc, schedule));
            } catch (Exception ex) {
                Log.Debug(ex, "Failed to collect schedule parameter evidence: ScheduleId={ScheduleId}, ScheduleName={ScheduleName}", schedule.Id.Value(), schedule.Name);
            }
        }

        return new ParameterEvidencePrimitiveSet(bindings, scheduleFields, collectedAt, CacheHit: false);
    }

    public static ParameterEvidenceData Collect(
        Document doc,
        ParameterEvidenceRequest request,
        ParameterEvidencePrimitiveSet primitives,
        IReadOnlyCollection<ElementId>? selectionIds = null
    ) {
        var issues = new List<RevitDataIssue>();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 25, maxSamplesPerEntry: 3);
        var builder = new CandidateBuilder(request, budget.MaxSamplesPerEntry ?? 3);
        var categoryNames = ToFilterSet(request.CategoryNames);
        var scheduleIds = request.ScheduleIds.ToHashSet();
        var scheduleUniqueIds = ToFilterSet(request.ScheduleUniqueIds);
        var scheduleNames = ToFilterSet(request.ScheduleNames);
        var candidateParameters = ParameterReferenceResolver.Resolve(request.CandidateParameters);

        foreach (var binding in primitives.ProjectBindings) {
            if (categoryNames.Count != 0 && !binding.CategoryNames.Any(categoryNames.Contains))
                continue;
            if (!ParameterReferenceResolver.Matches(binding.Identity, candidateParameters))
                continue;

            var matchedCategory = binding.CategoryNames.FirstOrDefault(categoryNames.Contains);
            builder.Add(
                binding.Definition,
                ParameterEvidenceSource.ProjectBinding,
                categoryNames.Count == 0 ? ParameterEvidenceScope.Document : ParameterEvidenceScope.Category,
                binding.Identity.Kind == ParameterIdentityKind.SharedGuid ? ParameterEvidenceStrength.Strong : ParameterEvidenceStrength.Medium,
                binding.Identity.Kind == ParameterIdentityKind.SharedGuid ? 18 : 12,
                matchedCategory == null
                    ? $"Project {binding.BindingKind.ToString().ToLowerInvariant()} binding"
                    : $"Project {binding.BindingKind.ToString().ToLowerInvariant()} binding for {matchedCategory}",
                matchedCategory
            );
        }

        foreach (var field in primitives.ScheduleFields) {
            if (categoryNames.Count != 0 && (field.CategoryName == null || !categoryNames.Contains(field.CategoryName)))
                continue;
            if (scheduleIds.Count != 0 && !scheduleIds.Contains(field.ScheduleId))
                continue;
            if (scheduleUniqueIds.Count != 0 && !scheduleUniqueIds.Contains(field.ScheduleUniqueId))
                continue;
            if (scheduleNames.Count != 0 && !scheduleNames.Contains(field.ScheduleName))
                continue;
            if (!ParameterReferenceResolver.Matches(field.Identity, candidateParameters))
                continue;

            var scope = field.IsPlacedOnSheet ? ParameterEvidenceScope.PrintedSchedule : ParameterEvidenceScope.Schedule;
            var strength = field.IsFilterField ? ParameterEvidenceStrength.Strong : ParameterEvidenceStrength.Medium;
            var score = field.IsFilterField ? 42 : 30;
            if (field.IsPlacedOnSheet)
                score += 10;
            builder.Add(
                field.Definition,
                field.IsFilterField ? ParameterEvidenceSource.ScheduleFilter : ParameterEvidenceSource.ScheduleField,
                scope,
                strength,
                score,
                field.IsFilterField
                    ? $"Schedule filter field in {field.ScheduleName}"
                    : $"Schedule field in {field.ScheduleName}",
                field.CategoryName,
                field.ScheduleName
            );
        }

        var scopedElements = ResolveElements(doc, request, selectionIds, issues);
        if (categoryNames.Count != 0) {
            scopedElements = scopedElements
                .Where(element => element.Category != null && categoryNames.Contains(element.Category.Name))
                .ToList();
        }

        var scopedEvidenceLimit = budget.MaxEntries.GetValueOrDefault(25) * 25;
        foreach (var element in scopedElements.Take(scopedEvidenceLimit)) {
            foreach (var parameter in EnumerateElementParameters(doc, element)) {
                if (parameter.Definition == null)
                    continue;

                var definition = BuildDefinition(parameter);
                if (!ParameterReferenceResolver.Matches(definition.Identity, candidateParameters))
                    continue;

                builder.Add(
                    definition,
                    ParameterEvidenceSource.ScopedElement,
                    ScopeFromRequest(request.Scope),
                    ParameterEvidenceStrength.Strong,
                    50,
                    $"Present on scoped {element.Category?.Name ?? "element"}",
                    element.Category?.Name,
                    element: ToHandle(doc, element)
                );
            }
        }

        var candidates = builder.Build()
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var maxEntries = budget.MaxEntries;
        var truncated = maxEntries is > 0 && candidates.Count > maxEntries.Value;
        var returned = truncated ? candidates.Take(maxEntries!.Value).ToList() : candidates;
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "ParameterEvidenceTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {returned.Count} of {candidates.Count} parameter evidence candidate(s). Increase budget.maxEntries to expand."
            ));
        }

        if (primitives.CacheHit) {
            issues.Add(new RevitDataIssue(
                "ParameterEvidencePrimitiveCacheHit",
                RevitDataIssueSeverity.Info,
                "Reused cached project binding and schedule field evidence primitives."
            ));
        }

        return new ParameterEvidenceData(
            returned,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(candidates.Count, returned.Count, truncated),
            primitives.CollectedAtUtc.ToString("O"),
            primitives.CacheHit
        );
    }

    private static ParameterDefinitionDescriptor BuildDefinition(Parameter parameter) {
        var definition = parameter.Definition;
        return new ParameterDefinitionDescriptor(
            ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(parameter)),
            null,
            NormalizeForgeTypeId(definition.GetDataType()),
            null,
            NormalizeForgeTypeId(definition.GetGroupTypeId()),
            null
        );
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    private static List<Element> ResolveElements(
        Document doc,
        ParameterEvidenceRequest request,
        IReadOnlyCollection<ElementId>? selectionIds,
        List<RevitDataIssue> issues
    ) {
        if (request.Scope == RevitElementScope.CurrentSelection) {
            return (selectionIds ?? [])
                .Select(doc.GetElement)
                .Where(element => element != null)
                .Cast<Element>()
                .Where(element => element.Category != null)
                .ToList();
        }
        if (request.Scope == RevitElementScope.ExplicitHandles) {
            var byId = request.ElementIds
                .Select(id => doc.GetElement(id.ToElementId()))
                .Where(element => element != null)
                .Cast<Element>();
            var byUniqueId = request.ElementUniqueIds
                .Select(doc.GetElement)
                .Where(element => element != null)
                .Cast<Element>();
            return byId.Concat(byUniqueId)
                .GroupBy(element => element.Id.Value())
                .Select(group => group.First())
                .Where(element => element.Category != null)
                .ToList();
        }
        if (request.Scope == RevitElementScope.ActiveViewVisible) {
            var activeView = doc.ActiveView;
            if (activeView != null) {
                return new FilteredElementCollector(doc, activeView.Id)
                    .WhereElementIsNotElementType()
                    .Where(element => element.Category != null)
                    .ToList();
            }

            issues.Add(new RevitDataIssue(
                "ParameterEvidenceNoActiveView",
                RevitDataIssueSeverity.Warning,
                "No active view was available; scoped element evidence fell back to all document elements."
            ));
        }

        if (request.CandidateParameters.Count == 0)
            return [];

        return new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .Where(element => element.Category != null)
            .Take(1000)
            .ToList();
    }

    private static IEnumerable<Parameter> EnumerateElementParameters(Document doc, Element element) {
        foreach (Parameter parameter in element.Parameters)
            yield return parameter;

        var typeElement = doc.GetElement(element.GetTypeId());
        if (typeElement == null)
            yield break;

        foreach (Parameter parameter in typeElement.Parameters)
            yield return parameter;
    }

    private static HashSet<string> ToFilterSet(IEnumerable<string>? values) =>
        values == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static ParameterEvidenceScope ScopeFromRequest(RevitElementScope scope) => scope switch {
        RevitElementScope.ActiveViewVisible => ParameterEvidenceScope.ActiveViewVisible,
        RevitElementScope.CurrentSelection => ParameterEvidenceScope.CurrentSelection,
        RevitElementScope.ExplicitHandles => ParameterEvidenceScope.ExplicitHandles,
        _ => ParameterEvidenceScope.Document
    };

    private static RevitElementHandle ToHandle(Document doc, Element element) {
        var type = doc.GetElement(element.GetTypeId()) as ElementType;
        var familyName = element is FamilyInstance familyInstance
            ? familyInstance.Symbol?.FamilyName
            : null;
        return new RevitElementHandle(
            element.Id.Value(),
            element.UniqueId,
            element.Name ?? string.Empty,
            element.Category?.Name,
            familyName,
            type?.Name
        );
    }

    private sealed class CandidateBuilder(ParameterEvidenceRequest request, int maxSamples) {
        private readonly Dictionary<string, CandidateState> _states = new(StringComparer.OrdinalIgnoreCase);

        public void Add(
            ParameterDefinitionDescriptor definition,
            ParameterEvidenceSource source,
            ParameterEvidenceScope scope,
            ParameterEvidenceStrength strength,
            double score,
            string reason,
            string? categoryName = null,
            string? scheduleName = null,
            RevitElementHandle? element = null
        ) {
            var state = this.GetState(definition);
            state.Score += this.ApplyRankingModeBoost(definition.Identity, source, scope, score);
            state.Counts[(source, scope, strength)] = state.Counts.GetValueOrDefault((source, scope, strength)) + 1;
            if (!state.Reasons.Contains(reason, StringComparer.OrdinalIgnoreCase) && state.Reasons.Count < 5)
                state.Reasons.Add(reason);
            if (state.Samples.Count < maxSamples) {
                state.Samples.Add(new ParameterEvidenceSample(
                    source,
                    scope,
                    strength,
                    reason,
                    categoryName,
                    scheduleName,
                    element?.DisplayName,
                    element
                ));
            }
        }

        public IEnumerable<ParameterEvidenceCandidate> Build() => this._states.Values.Select(state =>
            new ParameterEvidenceCandidate(
                state.Definition,
                Math.Round(state.Score, 2),
                state.Reasons,
                state.Counts
                    .OrderByDescending(entry => entry.Value)
                    .Select(entry => new ParameterEvidenceCount(entry.Key.Source, entry.Key.Scope, entry.Key.Strength, entry.Value))
                    .ToList(),
                state.Samples
            ));

        private CandidateState GetState(ParameterDefinitionDescriptor definition) {
            if (this._states.TryGetValue(definition.Identity.Key, out var state))
                return state;

            state = new CandidateState(definition);
            this._states[definition.Identity.Key] = state;
            return state;
        }

        private double ApplyRankingModeBoost(
            ParameterIdentity identity,
            ParameterEvidenceSource source,
            ParameterEvidenceScope scope,
            double score
        ) {
            if (request.RankingMode == ParameterEvidenceRankingMode.ScheduleJoin && source is ParameterEvidenceSource.ScheduleField or ParameterEvidenceSource.ScheduleFilter)
                score += 10;
            score += TaskTextOverlapScore(identity.Name, request.TaskText);
            if (scope == ParameterEvidenceScope.PrintedSchedule)
                score += 5;
            return score;
        }

        private static double TaskTextOverlapScore(string name, string? taskText) {
            if (string.IsNullOrWhiteSpace(taskText))
                return 0;

            var nameTokens = Tokenize(name);
            if (nameTokens.Count == 0)
                return 0;
            var taskTokens = Tokenize(taskText);
            var overlap = nameTokens.Count(taskTokens.Contains);
            return overlap == 0 ? 0 : Math.Min(12, overlap * 4);
        }

        private static HashSet<string> Tokenize(string value) => Regex.Split(value, @"[^A-Za-z0-9]+")
            .SelectMany(SplitCamelCase)
            .Where(token => token.Length >= 3)
            .Select(token => token.ToLowerInvariant())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        private static IEnumerable<string> SplitCamelCase(string value) => Regex.Matches(value, @"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|\d+")
            .Cast<Match>()
            .Select(match => match.Value);
    }

    private sealed class CandidateState(ParameterDefinitionDescriptor definition) {
        public ParameterDefinitionDescriptor Definition { get; } = definition;
        public double Score { get; set; }
        public List<string> Reasons { get; } = [];
        public Dictionary<(ParameterEvidenceSource Source, ParameterEvidenceScope Scope, ParameterEvidenceStrength Strength), int> Counts { get; } = [];
        public List<ParameterEvidenceSample> Samples { get; } = [];
    }
}
