using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

public sealed class ResolveBuildMatrixModule : Module<BuildMatrix> {
    protected override Task<BuildMatrix?> ExecuteAsync(IModuleContext context, CancellationToken cancellationToken) {
        var matrix = BuildConfigurationFile.LoadMatrix(context.Git().RootDirectory.Path);
        context.Summary.KeyValue("Build", "DefaultRevitConfiguration", matrix.DefaultRevitConfiguration);
        return Task.FromResult<BuildMatrix?>(matrix);
    }
}
