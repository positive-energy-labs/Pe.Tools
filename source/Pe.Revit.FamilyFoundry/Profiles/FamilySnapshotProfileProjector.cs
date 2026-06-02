using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Shared.RevitData;

namespace Pe.Revit.FamilyFoundry.Profiles;

public sealed record FamilySnapshotProfileProjection(
    FFManagerProfile DenseProfile,
    FFManagerProfile EmptyAllowedProfile
);

public static class FamilySnapshotProfileProjector {
    public static FamilySnapshotProfileProjection ProjectProfiles(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<ParameterSnapshot, bool>? isSharedParameter = null
    ) {
        var denseProfile = BuildProfile(snapshot, targetFamilyName, isSharedParameter, false);
        var emptyAllowedProfile = BuildProfile(snapshot, targetFamilyName, isSharedParameter, true);
        return new FamilySnapshotProfileProjection(denseProfile, emptyAllowedProfile);
    }

    public static FFManagerProfile ProjectToProfile(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<ParameterSnapshot, bool>? isSharedParameter = null
    ) => ProjectProfiles(snapshot, targetFamilyName, isSharedParameter).DenseProfile;

    private static FFManagerProfile BuildProfile(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<ParameterSnapshot, bool>? isSharedParameter = null,
        bool includeDefinitionOnlyParameters = false
    ) {
        if (snapshot == null)
            throw new ArgumentNullException(nameof(snapshot));

        if (string.IsNullOrWhiteSpace(targetFamilyName))
            throw new ArgumentException("Target family name is required.", nameof(targetFamilyName));

        var parameterSnapshots = snapshot.Parameters?.Data ?? [];
        var exportedParams = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
            parameterSnapshots,
            new FamilyParamProfileExportOptions {
                IncludeDefinitionOnlyParameters = includeDefinitionOnlyParameters,
                IsSharedParameter = isSharedParameter
            });
        var authoredSolids = snapshot.AuthoredParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
        var solidsPlan = AuthoredParamDrivenSolidsCompiler.Compile(authoredSolids);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Extrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Connectors))
            .ToList();
        var referencedSnapshotDefinitions = KnownParamPlanBuilder.BuildFamilyDefinitionsFromSnapshots(
            parameterSnapshots,
            additionalReferences,
            isSharedParameter);
        var resolvedFamilyParams = KnownParamPlanBuilder.MergeFamilyParamDefinitions(
            exportedParams.AddFamilyParams,
            referencedSnapshotDefinitions);
        var sharedSnapshotNames = parameterSnapshots
            .Where(parameter => IsSharedParameter(parameter, isSharedParameter))
            .Select(parameter => parameter.Name?.Trim())
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!)
            .ToHashSet(StringComparer.Ordinal);
        var requiredApsParameterNames = exportedParams.SetKnownParams.GetAllReferencedParameterNames()
            .Concat(additionalReferences)
            .Where(sharedSnapshotNames.Contains)
            .Concat(includeDefinitionOnlyParameters ? sharedSnapshotNames : [])
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        var globalAssignments = exportedParams.SetKnownParams.GlobalAssignments
            .GroupBy(assignment => assignment.Parameter, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var sharedParameters = requiredApsParameterNames
            .Select(name => CreateSharedDeclaration(name, globalAssignments))
            .ToList();
        var familyParameters = resolvedFamilyParams.Parameters
            .Where(parameter => !requiredApsParameterNames.Contains(parameter.Name, StringComparer.Ordinal))
            .Select(parameter => CreateFamilyDeclaration(parameter, globalAssignments))
            .ToList();
        var perTypeRows = exportedParams.SetKnownParams.PerTypeAssignmentsTable
            .Select(row => new DesiredPerTypeAssignmentRow {
                Parameter = row.Parameter,
                ValuesByType = new Dictionary<string, Newtonsoft.Json.Linq.JToken>(row.ValuesByType, StringComparer.Ordinal)
            })
            .ToList();

        return new FFManagerProfile {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies =
                new BaseProfile.FilterFamiliesSettings {
                    IncludeUnusedFamilies = true,
                    IncludeCategoriesEqualing = [],
                    IncludeNames = new IncludeFamilies { Equaling = [targetFamilyName] },
                    ExcludeNames = new ExcludeFamilies()
                },
            SharedParameterSelection = new SharedParameterSelectionSpec {
                Include = new SharedParameterSelectionFilter { Names = requiredApsParameterNames }
            },
            SharedParameters = sharedParameters,
            FamilyParameters = familyParameters,
            PerTypeAssignmentsTable = perTypeRows,
            SetLookupTables =
                new SetLookupTablesSettings {
                    Tables = snapshot.LookupTables?.Data?.Select(CloneLookupTable).ToList() ?? []
                },
            ParamDrivenSolids = authoredSolids
        };
    }

    private static DesiredSharedParameterDeclaration CreateSharedDeclaration(
        string name,
        IReadOnlyDictionary<string, GlobalParamAssignment> globalAssignments
    ) {
        globalAssignments.TryGetValue(name, out var assignment);
        return new DesiredSharedParameterDeclaration {
            Name = name,
            Value = assignment?.Kind == ParamAssignmentKind.Value ? assignment.Value : null,
            Formula = assignment?.Kind == ParamAssignmentKind.Formula ? assignment.Value : null
        };
    }

    private static DesiredFamilyParameterDeclaration CreateFamilyDeclaration(
        FamilyParamDefinitionModel parameter,
        IReadOnlyDictionary<string, GlobalParamAssignment> globalAssignments
    ) {
        globalAssignments.TryGetValue(parameter.Name, out var assignment);
        return new DesiredFamilyParameterDeclaration {
            Name = parameter.Name,
            DataType = parameter.DataType,
            PropertiesGroup = parameter.PropertiesGroup,
            IsInstance = parameter.IsInstance,
            Tooltip = parameter.Tooltip,
            Value = assignment?.Kind == ParamAssignmentKind.Value ? assignment.Value : null,
            Formula = assignment?.Kind == ParamAssignmentKind.Formula ? assignment.Value : null
        };
    }

    private static bool IsSharedParameter(
        ParameterSnapshot parameter,
        Func<ParameterSnapshot, bool>? isSharedParameter
    ) =>
        isSharedParameter?.Invoke(parameter) == true ||
        parameter.SharedGuid.HasValue ||
        parameter.Definition.Identity.Kind == ParameterIdentityKind.SharedGuid;

    private static LookupTableDefinition CloneLookupTable(LookupTableDefinition table) => new() {
        Schema = table.Schema with {
            Columns = table.Schema.Columns
                .Select(column => column with { })
                .ToList()
        },
        Rows = table.Rows
            .Select(row => row with {
                ValuesByColumn = new Dictionary<string, string>(row.ValuesByColumn, StringComparer.Ordinal)
            })
            .ToList()
    };
}