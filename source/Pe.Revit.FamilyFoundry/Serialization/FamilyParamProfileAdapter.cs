using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.Serialization;

public sealed record FamilyParamProfileExportOptions {
    public bool IncludeDefinitionOnlyParameters { get; init; }
    public bool OmitBuiltInParameters { get; init; } = true;
    public bool EnabledWhenEmpty { get; init; }
    public Func<ParameterSnapshot, bool>? IsSharedParameter { get; init; }
}

public sealed record FamilyParamProfileExport(
    AddFamilyParamsSettings AddFamilyParams,
    SetKnownParamsSettings SetKnownParams
);

public static class FamilyParamProfileAdapter {
    public static FamilyParamProfileExport ProjectSnapshotsToProfile(
        IEnumerable<ParameterSnapshot> snapshots,
        FamilyParamProfileExportOptions? options = null
    ) {
        options ??= new FamilyParamProfileExportOptions();

        var ordered = SortAndOrder(snapshots?.ToList() ?? []);
        var familyParameters = new List<FamilyParamDefinitionModel>();
        var globalAssignments = new List<GlobalParamAssignment>();
        var perTypeAssignments = new List<PerTypeAssignmentRow>();

        foreach (var snapshot in ordered) {
            if (options.OmitBuiltInParameters && snapshot.IsBuiltIn)
                continue;

            var globalAssignment = snapshot.ProjectToGlobalAssignment();
            var perTypeAssignment = snapshot.ProjectToPerTypeAssignmentRow();
            var hasReplayableAssignment = globalAssignment is not null || perTypeAssignment is not null;
            var shouldIncludeDefinition = options.IncludeDefinitionOnlyParameters || hasReplayableAssignment;

            if (!IsSharedParameter(snapshot, options) && shouldIncludeDefinition) {
                familyParameters.Add(new FamilyParamDefinitionModel {
                    Definition = ParameterDefinitionDescriptorFactory.NameFallback(
                        snapshot.Name ?? string.Empty,
                        snapshot.DataType,
                        snapshot.PropertiesGroup,
                        snapshot.IsInstance)
                });
            }

            if (globalAssignment is not null)
                globalAssignments.Add(globalAssignment);

            if (perTypeAssignment is not null)
                perTypeAssignments.Add(perTypeAssignment);
        }

        var familyEnabled = options.EnabledWhenEmpty || familyParameters.Count > 0;
        var assignmentsEnabled =
            options.EnabledWhenEmpty || globalAssignments.Count > 0 || perTypeAssignments.Count > 0;

        return new FamilyParamProfileExport(
            new AddFamilyParamsSettings { Enabled = familyEnabled, Parameters = familyParameters },
            new SetKnownParamsSettings {
                Enabled = assignmentsEnabled,
                OverrideExistingValues = true,
                GlobalAssignments = globalAssignments,
                PerTypeAssignmentsTable = perTypeAssignments
            }
        );
    }

    public static List<ParameterSnapshot> SortAndOrder(List<ParameterSnapshot> snapshots) {
        snapshots ??= [];
        return snapshots.Select(snapshot => snapshot with {
                ValuesPerType = snapshot.ValuesPerType
                    .OrderBy(kvp => kvp.Key, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(kvp => kvp.Key, kvp => kvp.Value, StringComparer.Ordinal)
            }).OrderBy(snapshot => snapshot.Name, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(snapshot => snapshot.IsInstance)
            .ToList();
    }

    private static bool IsSharedParameter(ParameterSnapshot snapshot, FamilyParamProfileExportOptions options) =>
        options.IsSharedParameter?.Invoke(snapshot) == true ||
        snapshot.SharedGuid.HasValue ||
        snapshot.Definition.Identity.Kind == ParameterIdentityKind.SharedGuid;
}