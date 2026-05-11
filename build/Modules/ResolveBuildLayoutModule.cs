using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

public sealed class ResolveBuildLayoutModule : Module<ProductLayoutAuthority> {
    protected override Task<ProductLayoutAuthority?> ExecuteAsync(IModuleContext context, CancellationToken cancellationToken) {
        var authority = ProductLayoutAuthority.ForRepository(context.Git().RootDirectory.Path);
        context.Summary.KeyValue("Build", "ArtifactsRoot", authority.Artifacts.ArtifactsRoot);
        return Task.FromResult<ProductLayoutAuthority?>(authority);
    }
}

// PE_HOT_RELOAD_NUDGE
