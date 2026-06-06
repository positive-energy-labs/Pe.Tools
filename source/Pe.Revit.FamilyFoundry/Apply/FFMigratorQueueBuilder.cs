using Newtonsoft.Json;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;

namespace Pe.Revit.FamilyFoundry.Apply;

public static class FFMigratorQueueBuilder {
    public static OperationQueue Build(
        FFMigratorProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var plan = DesiredParameterCompiler.Compile(profile, profile, apsParamData, profile.MappingData);
        var compiledProfile = DesiredMigrationPlanLowerer.LowerMigrator(profile, plan);
        return Build(compiledProfile, apsParamData, null, profile.ParamDrivenSolids);
    }

    public static OperationQueue Build(
        CompiledFamilyFoundryOperationProfile profile,
        List<SharedParameterDefinition> apsParamData,
        MapParamsSettings? localMapParams = null,
        AuthoredParamDrivenSolidsSettings? paramDrivenSolids = null
    ) {
        var profileClone = DeepCloneProfile(profile);
        var apsParamNames = apsParamData.Select(parameter => parameter.ExternalDefinition.Name).ToList();
        var localMappings = localMapParams ?? new MapParamsSettings { Enabled = false };
        var mappingDataAllNames = profileClone.AddAndMapSharedParams.MappingData
            .Concat(localMappings.MappingData)
            .SelectMany(mapping => mapping.CurrNames)
            .Concat(apsParamNames);
        var internalParams = BuildInternalParams(profileClone)
            .Where(internalParam => profileClone.AddFamilyParams.Parameters.All(existing =>
                !string.Equals(existing.Name, internalParam.Name, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        profileClone.AddFamilyParams.AddParameters(internalParams);
        var solidsPlan = paramDrivenSolids?.HasContent == true
            ? AuthoredParamDrivenSolidsCompiler.Compile(paramDrivenSolids)
            : null;
        if (solidsPlan?.CanExecute == false) {
            throw new InvalidOperationException(
                string.Join(Environment.NewLine,
                    ParamDrivenSolidsDiagnosticFormatter.ToDisplayMessages(solidsPlan.Diagnostics)));
        }

        var additionalReferences = profileClone.MakeElectricalConnector.Enabled
            ? KnownParamPlanBuilder.CollectReferencedParameterNames(profileClone.MakeElectricalConnector)
            : [];
        if (solidsPlan != null) {
            additionalReferences = additionalReferences
                .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.RefPlanesAndDims))
                .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Extrusions))
                .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Connectors))
                .ToList();
        }

        FFManagerQueueBuilder.AddSynthesizedSolidsParameters(profileClone.AddFamilyParams, additionalReferences, apsParamData);
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profileClone.AddFamilyParams,
            profileClone.SetKnownParams,
            apsParamData,
            additionalReferences
        );
        var apsAndAddedParamNames = apsParamNames
            .Concat(knownParamPlan.ResolvedFamilyParams.Parameters.Select(parameter => parameter.Name))
            .ToList();

        var queue = new OperationQueue()
            .Add(new CleanFamilyDocument(profileClone.CleanFamilyDocument, mappingDataAllNames))
            .Add(new AddAndMapSharedParams(profileClone.AddAndMapSharedParams, apsParamData))
            .Add(new AddAndMapFamilyParams(knownParamPlan.ResolvedFamilyParams, localMappings));

        if (solidsPlan != null) {
            var compilerMessages = solidsPlan.Diagnostics
                .Where(diagnostic => diagnostic.Severity == ParamDrivenDiagnosticSeverity.Warning)
                .Select(diagnostic => diagnostic.ToDisplayMessage())
                .ToList();
            queue
                .Add(new SetKnownParams(BuildValueFirstAssignments(knownParamPlan.ResolvedAssignments),
                    knownParamPlan.Catalog,
                    true))
                .Add(new EmitParamDrivenSolidsDiagnostics(new EmitParamDrivenSolidsDiagnosticsSettings {
                    Enabled = compilerMessages.Count > 0,
                    Messages = compilerMessages
                }))
                .Add(new MakeParamDrivenPlanesAndDims(solidsPlan.RefPlanesAndDims))
                .Add(new SetKnownParams(BuildFormulaOnlyAssignments(knownParamPlan.ResolvedAssignments),
                    knownParamPlan.Catalog))
                .Add(new MakeConstrainedExtrusions(solidsPlan.Extrusions))
                .Add(new MakeParamDrivenConnectors(solidsPlan.Connectors));
        } else {
            queue.Add(new SetKnownParams(knownParamPlan.ResolvedAssignments, knownParamPlan.Catalog));
        }

        return queue
            .Add(new MakeElecConnector(profileClone.MakeElectricalConnector))
            .Add(new DeleteParams(profileClone.DeleteParams))
            .Add(new PurgeParams(profileClone.CleanFamilyDocument.ResolvedPurgeParamsSettings, apsAndAddedParamNames))
            .Add(new SortParams(profileClone.SortParams));
    }

    private static CompiledFamilyFoundryOperationProfile DeepCloneProfile(CompiledFamilyFoundryOperationProfile profile) {
        var settings = new JsonSerializerSettings {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            PreserveReferencesHandling = PreserveReferencesHandling.None,
            MaxDepth = 128
        };
        var json = JsonConvert.SerializeObject(profile, Formatting.None, settings);
        return JsonConvert.DeserializeObject<CompiledFamilyFoundryOperationProfile>(json, settings)
               ?? throw new InvalidOperationException("Failed to clone compiled FF operation profile.");
    }

    private static SetKnownParamsSettings BuildValueFirstAssignments(SetKnownParamsSettings settings) =>
        new() {
            Enabled = settings.Enabled,
            OverrideExistingValues = settings.OverrideExistingValues,
            GlobalAssignments = settings.GlobalAssignments
                .Where(assignment => assignment.Kind == ParamAssignmentKind.Value)
                .ToList(),
            PerTypeAssignmentsTable = settings.PerTypeAssignmentsTable
        };

    private static SetKnownParamsSettings BuildFormulaOnlyAssignments(SetKnownParamsSettings settings) =>
        new() {
            Enabled = settings.Enabled,
            OverrideExistingValues = settings.OverrideExistingValues,
            GlobalAssignments = settings.GlobalAssignments
                .Where(assignment => assignment.Kind == ParamAssignmentKind.Formula)
                .ToList(),
            PerTypeAssignmentsTable = []
        };

    private static List<RevitParameterDefinition> BuildInternalParams(CompiledFamilyFoundryOperationProfile profile) {
        List<RevitParameterDefinition> paramList = [
            RevitParameterDefinition.DesiredFamilyParameter(
                "_FOUNDRY LAST PROCESSED AT",
                SpecTypeId.String.Text,
                new ForgeTypeId(""),
                false)
        ];
        profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
            Parameter = "_FOUNDRY LAST PROCESSED AT",
            Kind = ParamAssignmentKind.Formula,
            Value = $"\"{DateTime.Now:yyyy_MM_dd HH:mm:ss}\""
        });

        return paramList;
    }
}
