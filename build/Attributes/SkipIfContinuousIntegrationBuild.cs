using ModularPipelines.Attributes;
using ModularPipelines.Context;

namespace Build.Attributes;

public sealed class SkipIfContinuousIntegrationBuild : MandatoryRunConditionAttribute {
    public override Task<bool> Condition(IPipelineHookContext context) =>
        Task.FromResult(!context.BuildSystemDetector.IsKnownBuildAgent);
}