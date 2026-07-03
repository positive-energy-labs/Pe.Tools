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
            var action = File.Exists(generatedFile) ? "Updated" : "Deleted";
            context.Logger.LogInformation("{Action} generated build contract: {Path}", action, generatedFile);
            context.Summary.KeyValue(action, "BuildContract", generatedFile);
        }

        return Task.CompletedTask;
    }
}
