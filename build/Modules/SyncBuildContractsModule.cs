using Microsoft.Extensions.Logging;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

public sealed class SyncBuildContractsModule : Module {
    protected override Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var repositoryRoot = context.Git().RootDirectory.Path;
        var generatedFiles = BuildContractSync.SyncAll(repositoryRoot);

        if (generatedFiles.Count == 0) {
            context.Logger.LogInformation("Build contracts are already up to date.");
            return Task.CompletedTask;
        }

        foreach (var generatedFile in generatedFiles) {
            context.Logger.LogInformation("Updated generated build contract: {Path}", generatedFile);
            context.Summary.KeyValue("Generated", "BuildContract", generatedFile);
        }

        return Task.CompletedTask;
    }
}
