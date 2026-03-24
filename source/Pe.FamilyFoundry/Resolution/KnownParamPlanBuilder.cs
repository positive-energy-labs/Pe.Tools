using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global;
using Serilog;

namespace Pe.FamilyFoundry.Resolution;

public sealed record KnownParamPlan(
    AddFamilyParamsSettings ResolvedFamilyParams,
    SetKnownParamsSettings ResolvedAssignments,
    KnownParamCatalog Catalog,
    IReadOnlyList<string> ReferencedParameterNames,
    IReadOnlyList<string> RequiredApsParameterNames
);

public static class KnownParamPlanBuilder {
    public static KnownParamPlan Compile(
        AddFamilyParamsSettings familyParams,
        SetKnownParamsSettings assignments,
        IEnumerable<SharedParameterDefinition> sharedParams,
        IEnumerable<string>? additionalReferences = null
    ) {
        var normalizedFamilyParams = NormalizeFamilyParams(familyParams);
        var normalizedAssignments = NormalizeAssignments(assignments);
        var catalog = KnownParamResolver.BuildCatalog(normalizedFamilyParams, sharedParams);

        KnownParamResolver.ValidateAssignments(normalizedAssignments, catalog);

        var referencedParameterNames = normalizedAssignments.GetAllReferencedParameterNames()
            .Concat(additionalReferences ?? [])
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        KnownParamResolver.ValidateResolvedParameterNames(referencedParameterNames, catalog);

        var requiredFamilyDefinitions = KnownParamResolver.ExtractRequiredFamilyDefinitions(referencedParameterNames, catalog);
        var resolvedFamilyParams = MergeFamilyParamDefinitions(normalizedFamilyParams, requiredFamilyDefinitions);
        var requiredApsParameterNames = referencedParameterNames
            .Where(KnownParamResolver.IsPeParameterName)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        Log.Debug(
            "[KnownParamPlanBuilder] Compiled parameter plan with {FamilyParamCount} family definitions, {AssignmentCount} global assignments, {PerTypeCount} per-type rows, and {ApsCount} required APS parameters",
            resolvedFamilyParams.Parameters.Count,
            normalizedAssignments.GlobalAssignments.Count,
            normalizedAssignments.PerTypeAssignmentsTable.Count,
            requiredApsParameterNames.Count);

        return new KnownParamPlan(
            resolvedFamilyParams,
            normalizedAssignments,
            catalog,
            referencedParameterNames,
            requiredApsParameterNames
        );
    }

    public static IReadOnlyList<string> CollectReferencedParameterNames(
        MakeRefPlaneAndDimsSettings settings
    ) => settings.MirrorSpecs
        .Where(spec => !string.IsNullOrWhiteSpace(spec.Parameter))
        .Select(spec => spec.Parameter.Trim())
        .Concat(settings.OffsetSpecs
            .Where(spec => !string.IsNullOrWhiteSpace(spec.Parameter))
            .Select(spec => spec.Parameter.Trim()))
        .Distinct(StringComparer.Ordinal)
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    public static IReadOnlyList<string> CollectReferencedParameterNames(
        MakeConstrainedExtrusionsSettings settings
    ) => settings.Rectangles
        .SelectMany(spec => new[] { spec.PairAParameter, spec.PairBParameter, spec.HeightParameter })
        .Concat(settings.Circles.SelectMany(spec => new[] { spec.PairAParameter, spec.PairBParameter }))
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Select(name => name.Trim())
        .Distinct(StringComparer.Ordinal)
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    public static IReadOnlyList<string> CollectReferencedParameterNames(
        MakeElecConnectorSettings settings
    ) => new[] {
            settings.SourceParameterNames.Voltage,
            settings.SourceParameterNames.NumberOfPoles,
            settings.SourceParameterNames.ApparentPower,
            settings.SourceParameterNames.MinimumCircuitAmpacity
        }
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Select(name => name.Trim())
        .Distinct(StringComparer.Ordinal)
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    public static AddFamilyParamsSettings BuildFamilyDefinitionsFromSnapshots(
        IEnumerable<ParamSnapshot> snapshots,
        IEnumerable<string> referencedParameterNames
    ) {
        var snapshotByName = snapshots
            .Where(snapshot => !string.IsNullOrWhiteSpace(snapshot.Name))
            .GroupBy(snapshot => snapshot.Name.Trim(), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        var familyDefinitions = referencedParameterNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.Ordinal)
            .Where(name => !KnownParamResolver.IsPeParameterName(name))
            .Select(name => snapshotByName.TryGetValue(name, out var snapshot)
                ? new FamilyParamDefinitionModel {
                    Name = snapshot.Name,
                    IsInstance = snapshot.IsInstance,
                    PropertiesGroup = snapshot.PropertiesGroup,
                    DataType = snapshot.DataType
                }
                : null)
            .Where(definition => definition != null)
            .Select(definition => definition!)
            .ToList();

        return new AddFamilyParamsSettings {
            Enabled = familyDefinitions.Count > 0,
            Parameters = familyDefinitions
        };
    }

    public static AddFamilyParamsSettings MergeFamilyParamDefinitions(
        AddFamilyParamsSettings configuredFamilyParams,
        AddFamilyParamsSettings requiredFamilyParams
    ) {
        var merged = configuredFamilyParams.Parameters
            .Concat(requiredFamilyParams.Parameters)
            .GroupBy(parameter => parameter.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First() with { Name = group.Key })
            .OrderBy(parameter => parameter.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new AddFamilyParamsSettings {
            Enabled = configuredFamilyParams.Enabled || requiredFamilyParams.Enabled || merged.Count > 0,
            Parameters = merged
        };
    }

    private static AddFamilyParamsSettings NormalizeFamilyParams(AddFamilyParamsSettings settings) {
        var normalized = settings.Parameters
            .Select(parameter => parameter with { Name = parameter.Name?.Trim() ?? string.Empty })
            .ToList();

        return new AddFamilyParamsSettings {
            Enabled = settings.Enabled,
            Parameters = normalized
        };
    }

    private static SetKnownParamsSettings NormalizeAssignments(SetKnownParamsSettings settings) {
        var normalizedGlobalAssignments = settings.GetGlobalAssignmentsByParameter()
            .Values
            .Select(assignment => assignment with { Parameter = assignment.Parameter.Trim() })
            .ToList();

        var normalizedPerTypeAssignments = settings.PerTypeAssignmentsTable
            .Select(row => new PerTypeAssignmentRow {
                Parameter = row.Parameter?.Trim() ?? string.Empty,
                ValuesByType = row.ValuesByType
                    .Where(kvp => !string.IsNullOrWhiteSpace(kvp.Key))
                    .ToDictionary(
                        kvp => kvp.Key.Trim(),
                        kvp => kvp.Value,
                        StringComparer.Ordinal)
            })
            .ToList();

        SortGlobalAssignmentsByDependencies(normalizedGlobalAssignments);

        return new SetKnownParamsSettings {
            Enabled = settings.Enabled,
            OverrideExistingValues = settings.OverrideExistingValues,
            GlobalAssignments = normalizedGlobalAssignments,
            PerTypeAssignmentsTable = normalizedPerTypeAssignments
        };
    }

    private static void SortGlobalAssignmentsByDependencies(List<GlobalParamAssignment> assignments) {
        if (assignments.Count <= 1)
            return;

        var formulaAssignments = assignments
            .Where(assignment => assignment.Kind == ParamAssignmentKind.Formula)
            .ToList();

        if (formulaAssignments.Count <= 1)
            return;

        var formulaByName = formulaAssignments.ToDictionary(assignment => assignment.Parameter, StringComparer.Ordinal);
        var formulaNames = new HashSet<string>(formulaByName.Keys, StringComparer.Ordinal);
        var dependencies = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var inDegree = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var assignment in formulaAssignments) {
            var deps = ExtractReferencedParamNames(assignment.Value, formulaNames);
            dependencies[assignment.Parameter] = deps;
            inDegree[assignment.Parameter] = deps.Count;
        }

        var queue = new Queue<string>();
        foreach (var assignment in formulaAssignments.Where(assignment => inDegree[assignment.Parameter] == 0))
            queue.Enqueue(assignment.Parameter);

        var sortedFormulaNames = new List<string>();
        while (queue.Count > 0) {
            var parameterName = queue.Dequeue();
            sortedFormulaNames.Add(parameterName);

            foreach (var dependent in formulaAssignments.Where(assignment =>
                         dependencies[assignment.Parameter].Contains(parameterName))) {
                inDegree[dependent.Parameter]--;
                if (inDegree[dependent.Parameter] == 0)
                    queue.Enqueue(dependent.Parameter);
            }
        }

        if (sortedFormulaNames.Count < formulaAssignments.Count) {
            var unprocessed = formulaAssignments
                .Where(assignment => !sortedFormulaNames.Contains(assignment.Parameter, StringComparer.Ordinal))
                .Select(assignment => assignment.Parameter)
                .ToList();
            throw new InvalidOperationException(
                $"Circular dependency detected among SetKnownParams.GlobalAssignments formulas: {string.Join(", ", unprocessed)}. " +
                "Revit cannot resolve circular formula references.");
        }

        var sortedFormulaAssignments = sortedFormulaNames
            .Select(name => formulaByName[name])
            .ToList();
        var nextFormulaIndex = 0;

        for (var index = 0; index < assignments.Count; index++) {
            if (assignments[index].Kind != ParamAssignmentKind.Formula)
                continue;

            assignments[index] = sortedFormulaAssignments[nextFormulaIndex++];
        }
    }

    private static HashSet<string> ExtractReferencedParamNames(string formula, HashSet<string> validParamNames) {
        if (string.IsNullOrWhiteSpace(formula))
            return new HashSet<string>(StringComparer.Ordinal);

        var referenced = new HashSet<string>(StringComparer.Ordinal);

        foreach (var paramName in validParamNames) {
            if (IsParamReferencedInFormula(paramName, formula))
                _ = referenced.Add(paramName);
        }

        return referenced;
    }

    private static bool IsParamReferencedInFormula(string paramName, string formula) {
        if (string.IsNullOrEmpty(paramName) || string.IsNullOrEmpty(formula))
            return false;

        var boundaryChars = new[] {
            '+', '-', '*', '/', '^', '=', '>', '<', ' ', '[', ']', '(', ')', ',', '\t', '\r', '\n'
        };

        var searchStart = 0;
        while (searchStart < formula.Length) {
            var leftIndex = formula.IndexOf(paramName, searchStart, StringComparison.Ordinal);
            if (leftIndex == -1)
                return false;

            var leftValid = leftIndex == 0 || boundaryChars.Contains(formula[leftIndex - 1]);
            var rightIndex = leftIndex + paramName.Length;
            var rightValid = rightIndex >= formula.Length || boundaryChars.Contains(formula[rightIndex]);

            if (leftValid && rightValid)
                return true;

            searchStart = leftIndex + 1;
        }

        return false;
    }
}
