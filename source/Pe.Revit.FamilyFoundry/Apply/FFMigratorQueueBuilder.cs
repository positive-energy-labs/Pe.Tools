using Newtonsoft.Json;
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
        var profileClone = DeepCloneProfile(profile);
        var apsParamNames = apsParamData.Select(parameter => parameter.ExternalDefinition.Name).ToList();
        var mappingDataAllNames = profileClone.AddAndMapSharedParams.MappingData
            .SelectMany(mapping => mapping.CurrNames)
            .Concat(apsParamNames);
        var internalParams = BuildInternalParams(profileClone)
            .Where(internalParam => profileClone.AddFamilyParams.Parameters.All(existing =>
                !string.Equals(existing.Name, internalParam.Name, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        profileClone.AddFamilyParams.AddParameters(internalParams);
        var additionalReferences = profileClone.MakeElectricalConnector.Enabled
            ? KnownParamPlanBuilder.CollectReferencedParameterNames(profileClone.MakeElectricalConnector)
            : [];
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profileClone.AddFamilyParams,
            profileClone.SetKnownParams,
            apsParamData,
            additionalReferences
        );
        var apsAndAddedParamNames = apsParamNames
            .Concat(knownParamPlan.ResolvedFamilyParams.Parameters.Select(parameter => parameter.Name))
            .ToList();

        return new OperationQueue()
            .Add(new CleanFamilyDocument(profileClone.CleanFamilyDocument, mappingDataAllNames))
            .Add(new AddAndMapSharedParams(profileClone.AddAndMapSharedParams, apsParamData))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new SetKnownParams(knownParamPlan.ResolvedAssignments, knownParamPlan.Catalog))
            .Add(new MakeElecConnector(profileClone.MakeElectricalConnector))
            .Add(new DeleteParams(profileClone.DeleteParams))
            .Add(new PurgeParams(profileClone.CleanFamilyDocument.ResolvedPurgeParamsSettings, apsAndAddedParamNames))
            .Add(new SortParams(profileClone.SortParams));
    }

    private static FFMigratorProfile DeepCloneProfile(FFMigratorProfile profile) {
        var settings = new JsonSerializerSettings {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            PreserveReferencesHandling = PreserveReferencesHandling.None,
            MaxDepth = 128
        };
        var json = JsonConvert.SerializeObject(profile, Formatting.None, settings);
        return JsonConvert.DeserializeObject<FFMigratorProfile>(json, settings)
               ?? throw new InvalidOperationException("Failed to clone FF migrator profile.");
    }

    private static List<FamilyParamDefinitionModel> BuildInternalParams(FFMigratorProfile profile) {
        List<FamilyParamDefinitionModel> paramList = [
            new() {
                Name = "_FOUNDRY LAST PROCESSED AT",
                PropertiesGroup = new ForgeTypeId(""),
                DataType = SpecTypeId.String.Text,
                IsInstance = false
            }
        ];
        profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
            Parameter = "_FOUNDRY LAST PROCESSED AT",
            Kind = ParamAssignmentKind.Formula,
            Value = $"\"{DateTime.Now:yyyy_MM_dd HH:mm:ss}\""
        });

        return paramList;
    }
}
