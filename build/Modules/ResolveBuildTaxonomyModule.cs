using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

public sealed class ResolveBuildTaxonomyModule : Module<BuildTaxonomy> {
    protected override Task<BuildTaxonomy?> ExecuteAsync(IModuleContext context, CancellationToken cancellationToken) {
        var taxonomy = BuildTaxonomyFile.Load(context.Git().RootDirectory.Path);
        context.Summary.KeyValue("Build", "ProjectTaxonomyCount", taxonomy.Projects.Count.ToString());
        return Task.FromResult<BuildTaxonomy?>(taxonomy);
    }
}
