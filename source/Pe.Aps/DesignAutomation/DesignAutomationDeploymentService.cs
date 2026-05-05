using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public sealed class DesignAutomationDeploymentService {
    public async Task EnsureDeploymentAsync(
        AutomationApiClient automationClient,
        AutomationAppBundleSpec appBundleSpec,
        AutomationActivitySpec activitySpec,
        byte[] packageContents,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        log?.Invoke("Automation: resolving appbundle");
        await automationClient.CreateOrUpdateAppBundleAsync(
                appBundleSpec,
                packageContents,
                cancellationToken
            )
            .ConfigureAwait(false);

        log?.Invoke("Automation: resolving activity");
        await automationClient.CreateOrUpdateActivityAsync(activitySpec, cancellationToken)
            .ConfigureAwait(false);
    }
}
