using ModularPipelines.Attributes;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.SolutionPersistence.Model;
using Microsoft.VisualStudio.SolutionPersistence.Serializer;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

[DependsOn<ResolveBuildMatrixModule>]
public sealed class ValidateSolutionParityModule : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var matrix = matrixResult.ValueOrDefault!;
        var solution = context.Git().RootDirectory.FindFile(file => file.Extension == ".slnx");

        if (solution is null) {
            HandleParityIssue(context, "Solution parity validation skipped because Pe.Tools.slnx was not found.");
            return;
        }

        await using var stream = solution.GetStream();
        var model = await SolutionSerializers.SlnXml.OpenAsync(stream, cancellationToken);
        var missingConfigurations = matrix.SolutionConfigurations
            .Except(model.BuildTypes, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (missingConfigurations.Length == 0) {
            context.Summary.KeyValue("Build", "SolutionParity", "OK");
            return;
        }

        HandleParityIssue(
            context,
            $"Pe.Tools.slnx is missing build configurations declared in build/BuildConfiguration.props: {string.Join(", ", missingConfigurations)}");
    }

    private static void HandleParityIssue(IModuleContext context, string message) {
        if (string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(message);

        context.Logger.LogWarning("{Message}", message);
        context.Summary.KeyValue("Build", "SolutionParity", "Warning");
    }
}

// PE_HOT_RELOAD_NUDGE
