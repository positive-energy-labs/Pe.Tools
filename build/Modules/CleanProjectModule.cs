using ModularPipelines.Attributes;
using ModularPipelines.Conditions;
using ModularPipelines.Context;
using ModularPipelines.Modules;

namespace Build.Modules;

/// <summary>
///     Clean isolated artifact directories without touching interactive bin/obj outputs.
/// </summary>
[SkipIf<IsCI>]
[DependsOn<ResolveBuildLayoutModule>]
public sealed class CleanProjectModule : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var layout = layoutResult.ValueOrDefault!;
        var cleanTargets = new[] {
            layout.Artifacts.PackagesRoot,
            layout.Artifacts.PublishRoot
        }.Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var path in cleanTargets) {
            if (!Directory.Exists(path))
                continue;

            Directory.Delete(path, true);
        }
    }
}
