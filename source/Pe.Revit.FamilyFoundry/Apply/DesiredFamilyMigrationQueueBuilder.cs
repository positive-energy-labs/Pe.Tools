using Pe.Revit;
using Pe.Revit.FamilyFoundry.DesiredState;

namespace Pe.Revit.FamilyFoundry.Apply;

public sealed record DesiredFamilyMigrationQueueBuildResult(
    OperationQueue Queue,
    FamilyMigrationReconciliationPlan Plan,
    CompiledFamilyFoundryOperationProfile LoweredProfile
);

public static class DesiredFamilyMigrationQueueBuilder {
    public static DesiredFamilyMigrationQueueBuildResult Build(
        DesiredFamilyMigrationProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var plan = DesiredParameterCompiler.Compile(profile, profile, apsParamData, profile.MappingData);
        var loweredProfile = DesiredMigrationPlanLowerer.Lower(profile, plan);
        var localMapParams = DesiredMigrationPlanLowerer.BuildLocalMapParams(plan);
        var queue = FFMigratorQueueBuilder.Build(
            loweredProfile,
            apsParamData,
            localMapParams,
            profile.ParamDrivenSolids);

        return new DesiredFamilyMigrationQueueBuildResult(queue, plan, loweredProfile);
    }
}
