using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Profiles;

namespace Pe.Revit.FamilyFoundry.DesiredState;

public static class DesiredMigrationPlanLowerer {
    public static CompiledFamilyFoundryOperationProfile LowerManager(
        FFManagerProfile profile,
        FamilyMigrationReconciliationPlan plan
    ) => new() {
        ExecutionOptions = profile.ExecutionOptions,
        AddAndMapSharedParams = BuildSharedMapParams(plan.Parameters),
        AddFamilyParams = BuildAddFamilyParams(plan.Parameters),
        SetKnownParams = BuildSetKnownParams(plan.Parameters),
        SetLookupTables = profile.SetLookupTables,
        SortParams = new SortParamsSettings()
    };

    public static CompiledFamilyFoundryOperationProfile LowerMigrator(
        FFMigratorProfile profile,
        FamilyMigrationReconciliationPlan plan
    ) => new() {
        ExecutionOptions = profile.ExecutionOptions,
        CleanFamilyDocument = profile.CleanFamilyDocument,
        DeleteParams = profile.DeleteParams,
        AddAndMapSharedParams = BuildSharedMapParams(plan.Parameters),
        AddFamilyParams = BuildAddFamilyParams(plan.Parameters),
        SetKnownParams = BuildSetKnownParams(plan.Parameters),
        MakeElectricalConnector = new MakeElecConnectorSettings { Enabled = false },
        SortParams = profile.SortParams
    };

    public static CompiledFamilyFoundryOperationProfile Lower(
        DesiredFamilyMigrationProfile profile,
        FamilyMigrationReconciliationPlan plan
    ) => new() {
        ExecutionOptions = profile.ExecutionOptions,
        CleanFamilyDocument = profile.CleanFamilyDocument,
        DeleteParams = profile.DeleteParams,
        AddAndMapSharedParams = BuildSharedMapParams(plan.Parameters),
        AddFamilyParams = BuildAddFamilyParams(plan.Parameters),
        SetKnownParams = BuildSetKnownParams(plan.Parameters),
        MakeElectricalConnector = profile.MakeElectricalConnector,
        SortParams = profile.SortParams
    };

    public static MapParamsSettings BuildLocalMapParams(
        FamilyMigrationReconciliationPlan plan
    ) => BuildMapParams(plan.Parameters.Where(parameter => !parameter.IsShared));

    private static MapParamsSettings BuildSharedMapParams(
        IEnumerable<ResolvedDesiredParameter> parameters
    ) => BuildMapParams(parameters.Where(parameter => parameter.IsShared), includeTargetsWithoutSources: true);

    private static MapParamsSettings BuildMapParams(
        IEnumerable<ResolvedDesiredParameter> parameters,
        bool includeTargetsWithoutSources = false
    ) {
        var mappingData = parameters
            .Where(parameter => includeTargetsWithoutSources || parameter.Migration?.SourceNames.Count > 0)
            .Select(parameter => new MappingData {
                NewName = parameter.Definition.Name,
                CurrNames = parameter.Migration?.SourceNames
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Select(name => name.Trim())
                    .Distinct(StringComparer.Ordinal)
                    .ToList() ?? [],
                OnlyAddIfSourceExists = parameter.Migration?.OnlyAddIfSourceExists ?? false,
                MappingStrategy = parameter.Migration?.MappingStrategy ?? nameof(BuiltInCoercionStrategy.CoerceByStorageType)
            })
            .ToList();

        return new MapParamsSettings { Enabled = mappingData.Count > 0, MappingData = mappingData };
    }

    private static AddFamilyParamsSettings BuildAddFamilyParams(
        IEnumerable<ResolvedDesiredParameter> parameters
    ) {
        var familyParams = parameters
            .Where(parameter => !parameter.IsShared)
            .Select(parameter => RevitParameterDefinition.FromDescriptor(
                RevitParameterDefinition.Descriptor(
                    parameter.Definition.Identity,
                    parameter.Definition.DataType,
                    parameter.Definition.PropertiesGroup,
                    parameter.Definition.IsInstance),
                parameter.Definition.Tooltip))
            .ToList();

        return new AddFamilyParamsSettings { Enabled = familyParams.Count > 0, Parameters = familyParams };
    }

    private static SetKnownParamsSettings BuildSetKnownParams(IEnumerable<ResolvedDesiredParameter> parameters) {
        var globalAssignments = new List<GlobalParamAssignment>();
        var perTypeRows = new List<PerTypeAssignmentRow>();

        foreach (var parameter in parameters) {
            var parameterName = parameter.Definition.Name;
            if (parameter.Assignment != null) {
                globalAssignments.Add(new GlobalParamAssignment {
                    Parameter = parameterName,
                    Kind = parameter.Assignment.Kind,
                    Value = parameter.Assignment.Value
                });
            }

            var values = parameter.ValuesByType
                .Where(kvp => !string.IsNullOrWhiteSpace(kvp.Key) && kvp.Value != null)
                .ToDictionary(kvp => kvp.Key.Trim(), kvp => kvp.Value!, StringComparer.Ordinal);
            if (values.Count == 0)
                continue;

            var row = new PerTypeAssignmentRow { Parameter = parameterName };
            foreach (var kvp in values)
                row.ValuesByType[kvp.Key] = JToken.FromObject(kvp.Value);
            perTypeRows.Add(row);
        }

        return new SetKnownParamsSettings {
            Enabled = globalAssignments.Count > 0 || perTypeRows.Count > 0,
            OverrideExistingValues = true,
            GlobalAssignments = globalAssignments,
            PerTypeAssignmentsTable = perTypeRows
        };
    }
}
