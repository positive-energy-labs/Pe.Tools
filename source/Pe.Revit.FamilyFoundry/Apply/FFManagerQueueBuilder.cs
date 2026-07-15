using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;

namespace Pe.Revit.FamilyFoundry.Apply;

public static class FFManagerQueueBuilder {
    public static OperationQueue Build(
        FFManagerProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var plan = DesiredParameterCompiler.Compile(profile, profile, apsParamData);
        var compiledProfile = DesiredMigrationPlanLowerer.LowerManager(profile, plan);
        return Build(compiledProfile, apsParamData, profile.ParamDrivenSolids);
    }

    private static OperationQueue Build(
        CompiledFamilyFoundryOperationProfile profile,
        List<SharedParameterDefinition> apsParamData,
        AuthoredParamDrivenSolidsSettings paramDrivenSolids
    ) {
        var specs = new List<RefPlaneSubcategorySpec> {
            new() { Strength = RpStrength.WeakRef, Name = "WeakRef", Color = new Color(217, 124, 0) },
            new() { Strength = RpStrength.StrongRef, Name = "StrongRef", Color = new Color(255, 0, 0) },
            new() { Strength = RpStrength.CenterLR, Name = "Center", Color = new Color(115, 0, 253) },
            new() { Strength = RpStrength.CenterFB, Name = "Center", Color = new Color(115, 0, 253) }
        };

        var compiledSolids = AuthoredParamDrivenSolidsCompiler.Compile(paramDrivenSolids);
        if (!compiledSolids.CanExecute) {
            throw new InvalidOperationException(
                string.Join(Environment.NewLine,
                    ParamDrivenSolidsDiagnosticFormatter.ToDisplayMessages(compiledSolids.Diagnostics)));
        }

        var additionalReferences = KnownParamPlanBuilder
            .CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Extrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Connectors))
            .ToList();
        AddSynthesizedSolidsParameters(profile.AddFamilyParams, additionalReferences, apsParamData);

        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profile.AddFamilyParams,
            profile.SetKnownParams,
            apsParamData,
            additionalReferences);

        var compilerMessages = compiledSolids.Diagnostics
            .Where(diagnostic => diagnostic.Severity == ParamDrivenDiagnosticSeverity.Warning)
            .Select(diagnostic => diagnostic.ToDisplayMessage())
            .ToList();

        var valueFirstAssignments = BuildValueFirstAssignments(knownParamPlan.ResolvedAssignments);
        var formulaOnlyAssignments = BuildFormulaOnlyAssignments(knownParamPlan.ResolvedAssignments);

        return new OperationQueue()
            .Add(new AddSharedParams(SharedParameterMappingTargets.ByName(apsParamData).Values))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new SetLookupTables(profile.SetLookupTables))
            .Add(new SetKnownParams(valueFirstAssignments, knownParamPlan.Catalog, true))
            .Add(new EmitParamDrivenSolidsDiagnostics(new EmitParamDrivenSolidsDiagnosticsSettings {
                Enabled = compilerMessages.Count > 0,
                Messages = compilerMessages
            }))
            .Add(new MakeParamDrivenPlanesAndDims(compiledSolids.RefPlanesAndDims))
            .Add(new SetKnownParams(formulaOnlyAssignments, knownParamPlan.Catalog))
            .Add(new MakeConstrainedExtrusions(compiledSolids.Extrusions))
            .Add(new MakeParamDrivenConnectors(compiledSolids.Connectors))
            .Add(new AddRoomDingler(profile.AddRoomDingler))
            .Add(new MakeRefPlaneSubcategories(specs))
            .Add(new SortParams(profile.SortParams));
    }

    internal static void AddSynthesizedSolidsParameters(
        AddFamilyParamsSettings familyParams,
        IEnumerable<string> referencedNames,
        IEnumerable<SharedParameterDefinition> sharedParameters
    ) {
        var existingNames = familyParams.Parameters
            .Select(parameter => parameter.Name)
            .Concat(sharedParameters.Select(parameter => parameter.ExternalDefinition.Name))
            .ToHashSet(StringComparer.Ordinal);
        var missingParameters = referencedNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.Ordinal)
            .Where(name => !existingNames.Contains(name))
            .Select(name => RevitParameterDefinition.DesiredFamilyParameter(name, SpecTypeId.Length))
            .ToList();
        familyParams.AddParameters(missingParameters);
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
}
