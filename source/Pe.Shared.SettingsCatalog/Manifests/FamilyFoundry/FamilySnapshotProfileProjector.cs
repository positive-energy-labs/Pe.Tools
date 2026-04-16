using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Plans;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

namespace Pe.Revit.FamilyFoundry.Profiles;

public sealed record FamilySnapshotProfileProjection(
    FFManagerProfile DenseProfile,
    FFManagerProfile EmptyAllowedProfile
);

public static class FamilySnapshotProfileProjector {
    public static FamilySnapshotProfileProjection ProjectProfiles(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<string, bool>? isSharedParameterName = null
    ) {
        var denseProfile = BuildProfile(snapshot, targetFamilyName, isSharedParameterName, includeDefinitionOnlyParameters: false);
        var emptyAllowedProfile = BuildProfile(snapshot, targetFamilyName, isSharedParameterName, includeDefinitionOnlyParameters: true);
        return new FamilySnapshotProfileProjection(denseProfile, emptyAllowedProfile);
    }

    public static FFManagerProfile ProjectToProfile(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<string, bool>? isSharedParameterName = null
    ) => ProjectProfiles(snapshot, targetFamilyName, isSharedParameterName).DenseProfile;

    private static FFManagerProfile BuildProfile(
        FamilySnapshot snapshot,
        string targetFamilyName,
        Func<string, bool>? isSharedParameterName = null,
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
                IsSharedParameterName = isSharedParameterName
            });
        var authoredSolids = snapshot.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
        var solidsPlan = AuthoredParamDrivenSolidsCompiler.Compile(authoredSolids);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Connectors))
            .ToList();
        var referencedSnapshotDefinitions = KnownParamPlanBuilder.BuildFamilyDefinitionsFromSnapshots(
            parameterSnapshots,
            additionalReferences,
            isSharedParameterName);
        var resolvedFamilyParams = KnownParamPlanBuilder.MergeFamilyParamDefinitions(
            exportedParams.AddFamilyParams,
            referencedSnapshotDefinitions);
        var requiredApsParameterNames = exportedParams.SetKnownParams.GetAllReferencedParameterNames()
            .Concat(additionalReferences)
            .Concat(includeDefinitionOnlyParameters
                ? parameterSnapshots
                    .Select(parameter => parameter.Name?.Trim())
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Select(name => name!)
                    .Where(name => isSharedParameterName?.Invoke(name) ?? KnownParamResolver.IsPeParameterName(name))
                : [])
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        return new FFManagerProfile {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies = new BaseProfile.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies { Equaling = [targetFamilyName] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfile.FilterApsParamsSettings {
                IncludeNames = new IncludeSharedParameter { Equaling = requiredApsParameterNames },
                ExcludeNames = new ExcludeSharedParameter()
            },
            AddFamilyParams = resolvedFamilyParams,
            SetLookupTables = new SetLookupTablesSettings {
                Tables = snapshot.LookupTables?.Data?.Select(CloneLookupTable).ToList() ?? []
            },
            SetKnownParams = exportedParams.SetKnownParams,
            ParamDrivenSolids = authoredSolids
        };
    }

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
