using Pe.Revit.FamilyFoundry.Operations;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

/// <summary>
///     Set parameter values and formulas: SetParamValues (global formulas/values), then SetParamValuesPerType
///     (per-type cells and failed-global fallbacks). Types are created by <see cref="CreateFamilyTypes" /> upstream.
/// </summary>
public class SetKnownParams(SetKnownParamsSettings settings)
    : OperationGroup<SetKnownParamsSettings>(
        $"Set parameter values/formulas: {settings.GlobalAssignments.Count} global, {settings.PerTypeAssignmentsTable.Count} per-type rows.",
        settings.Enabled ? [new SetParamValues(settings), new SetParamValuesPerType(settings)] : [],
        settings.GlobalAssignments.Select(a => a.Parameter.Trim()).Concat(settings.GetPerTypeAssignmentsByParameter().Keys).Distinct(StringComparer.Ordinal).ToList()) {
}
