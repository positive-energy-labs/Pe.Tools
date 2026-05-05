using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitVersions;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationShellDeploymentService {
    private readonly RevitAutomationWorkerBundleBuilder _bundleBuilder = new();
    private readonly DesignAutomationDeploymentService _deployment = new();

    public async Task<ResolvedAutomationShellIds> EnsureReadyAsync(
        string repoRoot,
        RevitAutomationSettings settings,
        RevitVersionSpec spec,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var shellIds = RevitAutomationShellDefinitions.ForYear(settings, spec.Year);
        var bundle = await this._bundleBuilder.BuildAsync(repoRoot, spec.DesignAutomationEngine, log, cancellationToken)
            .ConfigureAwait(false);

        await EnsureReadyAsync(
                createAutomationClient(),
                shellIds,
                spec,
                bundle.PackageContents,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        return shellIds;
    }

    public async Task EnsureReadyAsync(
        string repoRoot,
        ResolvedAutomationShellIds shellIds,
        RevitVersionSpec spec,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var bundle = await this._bundleBuilder.BuildAsync(repoRoot, spec.DesignAutomationEngine, log, cancellationToken)
            .ConfigureAwait(false);

        await EnsureReadyAsync(
                createAutomationClient(),
                shellIds,
                spec,
                bundle.PackageContents,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
    }

    private async Task EnsureReadyAsync(
        AutomationApiClient automationClient,
        ResolvedAutomationShellIds shellIds,
        RevitVersionSpec spec,
        byte[] packageContents,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        await this._deployment.EnsureDeploymentAsync(
                automationClient,
                new AutomationAppBundleSpec {
                    Id = shellIds.AppBundleId,
                    Package = shellIds.AppBundleId,
                    Engine = spec.DesignAutomationEngine,
                    Description = "Pe.Tools Revit automation shell",
                    AliasId = shellIds.AliasId
                },
                RevitAutomationShellDefinitions.CreateActivitySpec(shellIds, spec.DesignAutomationEngine),
                packageContents,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
    }
}
