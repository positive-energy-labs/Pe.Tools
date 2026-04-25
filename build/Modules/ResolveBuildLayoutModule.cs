using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

public sealed class ResolveBuildLayoutModule : Module<BuildLayout> {
    protected override Task<BuildLayout?> ExecuteAsync(IModuleContext context, CancellationToken cancellationToken) {
        var layout = BuildConfigurationFile.LoadLayout(context.Git().RootDirectory.Path);
        context.Summary.KeyValue("Build", "ArtifactsRoot", layout.ArtifactsRoot);
        return Task.FromResult<BuildLayout?>(layout);
    }
}

// PE_HOT_RELOAD_NUDGE
