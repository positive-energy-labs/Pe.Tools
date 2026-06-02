using Pe.Shared.RevitData;
using System.Text.RegularExpressions;

namespace Pe.Revit.DocumentData.Parameters;

public static class ConceptEvidenceCollector {
    private static readonly IReadOnlyDictionary<string, string[]> ConceptAliases = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase) {
        ["tag"] = ["tag", "mark", "identifier", "equipment id"],
        ["location"] = ["location", "room", "space", "area", "level"],
        ["description"] = ["description", "desc", "type description"],
        ["manufacturer"] = ["manufacturer", "mfr"],
        ["model"] = ["model", "model number"],
        ["notes"] = ["notes", "comment", "remarks"],
        ["voltage"] = ["voltage", "volt", "volts"],
        ["current"] = ["current", "amperage", "amps", "fla", "mca"],
        ["minimum circuit ampacity"] = ["minimum circuit ampacity", "mca"],
        ["overcurrent protection"] = ["overcurrent", "mocp", "breaker", "fuse", "maximum overcurrent protection"],
        ["load"] = ["load", "apparent", "va", "power", "watt"],
        ["panel"] = ["panel", "panelboard"],
        ["circuit"] = ["circuit", "branch circuit", "circuit number"],
        ["load name"] = ["load name", "circuit load", "connected load name"],
        ["status"] = ["status", "readiness", "complete", "incomplete"],
        ["category"] = ["category", "classification", "load category"],
        ["filter"] = ["filter", "routing", "route"],
        ["design temperature"] = ["design temperature", "design temp", "temperature", "summer", "winter", "indoor", "outdoor", "db", "wb"]
    };

    public static ConceptEvidenceData Collect(
        ConceptEvidenceRequest request,
        ParameterEvidencePrimitiveSet primitives
    ) {
        var issues = new List<RevitDataIssue>();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 8, maxSamplesPerEntry: 3);
        var concepts = ResolveConcepts(request);
        var subjectHints = ToTokenSet(request.SubjectHints);
        var cards = concepts
            .Select(concept => BuildCard(concept, request, primitives, subjectHints, budget.MaxEntries.GetValueOrDefault(8), budget.MaxSamplesPerEntry.GetValueOrDefault(3)))
            .Where(card => card.Candidates.Count != 0)
            .ToList();

        if (cards.Count == 0) {
            issues.Add(new RevitDataIssue(
                "ConceptEvidenceNoCandidates",
                RevitDataIssueSeverity.Warning,
                "No concept evidence candidates matched the query or concept hints. Try broader wording or inspect revit.catalog.parameter-evidence without candidate filters."
            ));
        }

        if (primitives.CacheHit) {
            issues.Add(new RevitDataIssue(
                "ConceptEvidencePrimitiveCacheHit",
                RevitDataIssueSeverity.Info,
                "Reused cached project binding and schedule field evidence primitives."
            ));
        }

        return new ConceptEvidenceData(
            cards,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(concepts.Count, cards.Count, cards.Count < concepts.Count),
            primitives.CollectedAtUtc.ToString("O"),
            primitives.CacheHit
        );
    }

    private static ConceptEvidenceCard BuildCard(
        string concept,
        ConceptEvidenceRequest request,
        ParameterEvidencePrimitiveSet primitives,
        HashSet<string> subjectHints,
        int maxEntries,
        int maxSamples
    ) {
        var conceptTokens = GetConceptTokens(concept);
        var candidates = new Dictionary<string, CandidateAccumulator>(StringComparer.OrdinalIgnoreCase);

        if (request.IncludeBindings) {
            foreach (var binding in primitives.ProjectBindings) {
                AddCandidate(candidates, binding.Definition, conceptTokens, subjectHints, binding.CategoryNames, null, false, false, 0, maxSamples);
            }
        }

        if (request.IncludeSchedules) {
            foreach (var field in primitives.ScheduleFields) {
                AddCandidate(
                    candidates,
                    field.Definition,
                    conceptTokens,
                    subjectHints,
                    field.CategoryName == null ? [] : [field.CategoryName],
                    field,
                    field.IsFilterField,
                    field.IsPlacedOnSheet,
                    field.FieldIndex,
                    maxSamples
                );
            }
        }

        var ranked = candidates.Values
            .Select(candidate => candidate.ToCandidate())
            .Where(candidate => candidate.Score > 0)
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.Identity.Name, StringComparer.OrdinalIgnoreCase)
            .Take(maxEntries)
            .ToList();

        var notes = new List<string> {
            "Scores order factual evidence; they are not role, intent, or anomaly labels.",
            "Subject/category hints add weak context only and do not define the expected result shape."
        };

        return new ConceptEvidenceCard(concept, ranked, notes);
    }

    private static void AddCandidate(
        Dictionary<string, CandidateAccumulator> candidates,
        ParameterDefinitionDescriptor definition,
        HashSet<string> conceptTokens,
        HashSet<string> subjectHints,
        IReadOnlyList<string> categoryNames,
        ParameterScheduleFieldEvidence? scheduleField,
        bool isFilterField,
        bool isPlacedOnSheet,
        int fieldIndex,
        int maxSamples
    ) {
        var identity = definition.Identity;
        var parameterTokens = Tokenize(identity.Name)
            .Concat(Tokenize(identity.Key))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var lexicalHits = conceptTokens.Count == 0 ? 0 : conceptTokens.Count(parameterTokens.Contains);
        var acronymHit = conceptTokens.Any(token => string.Equals(token, identity.Name, StringComparison.OrdinalIgnoreCase));
        if (lexicalHits == 0 && !acronymHit)
            return;

        if (!candidates.TryGetValue(identity.Key, out var candidate)) {
            candidate = new CandidateAccumulator(definition, maxSamples);
            candidates[identity.Key] = candidate;
        }

        var categoryHit = subjectHints.Count != 0 && categoryNames.SelectMany(Tokenize).Any(subjectHints.Contains);
        var evidenceScore = scheduleField == null ? 5 : isFilterField ? 18 : 12;
        var lexicalScore = lexicalHits * 10 + (acronymHit ? 10 : 0);
        var placementScore = isPlacedOnSheet ? 4 : 0;
        var categoryScore = categoryHit ? 3 : 0;
        var positionScore = scheduleField == null ? 0 : Math.Max(0, 5 - Math.Min(fieldIndex, 5));

        candidate.Score += lexicalScore + evidenceScore + placementScore + categoryScore + positionScore;
        candidate.Categories.UnionWith(categoryNames.Where(name => !string.IsNullOrWhiteSpace(name)));
        if (scheduleField == null) {
            candidate.BindingCount++;
        } else {
            candidate.ScheduleFieldCount++;
            candidate.FieldIndexTotal += fieldIndex;
            if (isFilterField)
                candidate.ScheduleFilterCount++;
            if (isPlacedOnSheet)
                candidate.PlacedScheduleFieldCount++;
            if (candidate.SampleSchedules.Count < maxSamples)
                candidate.SampleSchedules.Add(scheduleField.ScheduleName);
        }

        if (lexicalHits != 0)
            candidate.Reasons.Add($"Name overlaps concept token(s): {string.Join(", ", conceptTokens.Where(parameterTokens.Contains).OrderBy(token => token))}");
        if (acronymHit)
            candidate.Reasons.Add("Name exactly matches a concept token or acronym.");
        if (categoryHit)
            candidate.Reasons.Add("Binding or schedule category overlaps subject hint; treated as weak context.");
        if (isFilterField)
            candidate.Reasons.Add("Used as a schedule filter field.");
        if (isPlacedOnSheet)
            candidate.Reasons.Add("Used by a schedule placed on a sheet.");
    }

    private static List<string> ResolveConcepts(ConceptEvidenceRequest request) {
        var explicitConcepts = request.ConceptHints
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (explicitConcepts.Count != 0)
            return explicitConcepts;

        var queryTokens = Tokenize(request.Query ?? string.Empty).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var inferred = ConceptAliases
            .Where(pair => pair.Value.SelectMany(Tokenize).Any(queryTokens.Contains) || Tokenize(pair.Key).Any(queryTokens.Contains))
            .Select(pair => pair.Key)
            .ToList();

        if (inferred.Count != 0)
            return inferred;

        return string.IsNullOrWhiteSpace(request.Query)
            ? ["project standard"]
            : [request.Query!.Trim()];
    }

    private static HashSet<string> GetConceptTokens(string concept) {
        var tokens = Tokenize(concept).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in ConceptAliases) {
            if (!string.Equals(pair.Key, concept, StringComparison.OrdinalIgnoreCase))
                continue;
            foreach (var token in pair.Value.SelectMany(Tokenize))
                tokens.Add(token);
        }

        return tokens;
    }

    private static HashSet<string> ToTokenSet(IEnumerable<string> values) => values
        .SelectMany(Tokenize)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static IEnumerable<string> Tokenize(string? value) {
        if (string.IsNullOrWhiteSpace(value))
            yield break;

        foreach (Match match in Regex.Matches(value, "[A-Za-z0-9]+")) {
            var token = match.Value.ToLowerInvariant();
            if (token is "pe" or "g" or "m" or "e" or "p" or "the" or "and" or "for" or "with" or "equipment")
                continue;
            yield return token;
        }
    }

    private sealed class CandidateAccumulator(ParameterDefinitionDescriptor definition, int maxSamples) {
        public ParameterDefinitionDescriptor Definition { get; } = definition;
        public double Score { get; set; }
        public int BindingCount { get; set; }
        public HashSet<string> Categories { get; } = new(StringComparer.OrdinalIgnoreCase);
        public int ScheduleFieldCount { get; set; }
        public int ScheduleFilterCount { get; set; }
        public int FieldIndexTotal { get; set; }
        public int PlacedScheduleFieldCount { get; set; }
        public HashSet<string> SampleSchedules { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Reasons { get; } = new(StringComparer.OrdinalIgnoreCase);

        public ConceptEvidenceCandidate ToCandidate() {
            var confidence = this.Score >= 50 && this.ScheduleFieldCount != 0
                ? ConceptEvidenceConfidence.High
                : this.Score >= 25
                    ? ConceptEvidenceConfidence.Medium
                    : ConceptEvidenceConfidence.Low;
            var averageFieldIndex = this.ScheduleFieldCount == 0
                ? null
                : (double?)Math.Round((double)this.FieldIndexTotal / this.ScheduleFieldCount, 2);
            return new ConceptEvidenceCandidate(
                this.Definition,
                Math.Round(this.Score, 2),
                confidence,
                this.Reasons.OrderBy(reason => reason, StringComparer.OrdinalIgnoreCase).ToList(),
                new ConceptEvidenceFacts(
                    this.BindingCount,
                    this.Categories.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                    this.ScheduleFieldCount,
                    this.ScheduleFilterCount,
                    averageFieldIndex,
                    this.PlacedScheduleFieldCount,
                    this.SampleSchedules.Take(maxSamples).OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList()
                )
            );
        }
    }
}
