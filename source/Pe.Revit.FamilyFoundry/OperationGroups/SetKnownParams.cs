using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

/// <summary>
///     Operation group that optionally creates missing family types, then sets parameter values/formulas.
///     Execution order:
///     0. CreateFamilyTypes (if createMissingFamilyTypes=true) - creates missing family types from PerTypeAssignmentsTable columns
///     1. SetParamValues - sets global formulas or values from GlobalAssignments
///     2. SetParamValuesPerType - handles explicit per-type values and failed global value fallbacks
/// </summary>
public class SetKnownParams(
    SetKnownParamsSettings settings,
    KnownParamCatalog knownParamCatalog,
    bool createMissingFamilyTypes = false)
    : OperationGroup<SetKnownParamsSettings>(
        InitializeDescription(),
        InitializeOperations(settings, knownParamCatalog, createMissingFamilyTypes),
        GetGroupContextKeys(settings)) {
    public static string InitializeDescription() =>
        $"Set already-known parameters from explicit global assignments and per-type assignment tables. " +
        $"Global assignments use <{nameof(SetKnownParamsSettings.GlobalAssignments)}> and may be formulas or values. " +
        $"Per-type values use <{nameof(SetKnownParamsSettings.PerTypeAssignmentsTable)}> and are always treated as values. " +
        $"If <{nameof(SetKnownParamsSettings.OverrideExistingValues)}> is true, then existing parameter values will be overwritten.";

    private static List<IOperation> InitializeOperations(
        SetKnownParamsSettings settings,
        KnownParamCatalog knownParamCatalog,
        bool createMissingFamilyTypes
    ) {
        KnownParamResolver.ValidateAssignments(settings, knownParamCatalog);
        var sharedState = new KnownParamsSharedState();

        var ops = new List<IOperation>();
        if (!settings.Enabled) return ops;

        if (createMissingFamilyTypes)
            ops.Add(new CreateFamilyTypes(settings, sharedState));

        ops.Add(new SetParamValues(settings));
        ops.Add(new SetParamValuesPerType(settings));
        if (createMissingFamilyTypes)
            ops.Add(new FinalizeFamilyTypes(settings, sharedState));

        return ops;
    }

    private static IEnumerable<string> GetGroupContextKeys(SetKnownParamsSettings settings) {
        var keys = settings.GlobalAssignments
            .Where(assignment => !string.IsNullOrWhiteSpace(assignment.Parameter))
            .Select(assignment => assignment.Parameter.Trim())
            .Concat(settings.GetPerTypeAssignmentsByParameter().Keys)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        return keys;
    }
}

internal sealed class KnownParamsSharedState {
    public bool CreatedDefaultPlaceholderType { get; set; }
}
