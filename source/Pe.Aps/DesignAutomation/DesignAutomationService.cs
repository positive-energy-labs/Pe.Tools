using Pe.Aps.Auth;
using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public sealed class DesignAutomationService(Func<AutomationApiClient> createAutomationClient) {
    private readonly DesignAutomationArtifactFinalizer _artifactFinalizer = new();
    private readonly DesignAutomationBatchWorkItemRunner _batchRunner = new();
    private readonly DesignAutomationDeploymentService _deployment = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();

    public AutomationApiClient CreateAutomationClient() => createAutomationClient();

    public Task EnsureDeploymentReadyAsync(
        AutomationAppBundleSpec appBundle,
        AutomationActivitySpec activity,
        byte[] packageContents,
        Action<string>? log,
        CancellationToken cancellationToken
    ) =>
        this._deployment.EnsureDeploymentAsync(
            createAutomationClient(),
            appBundle,
            activity,
            packageContents,
            log,
            cancellationToken
        );

    public Task<SubmittedDesignAutomationWorkItem> SubmitAsync(
        AutomationWorkItemSpec spec,
        string progressMessage,
        Action<string>? log,
        CancellationToken cancellationToken
    ) =>
        this._workItemRunner.SubmitAsync(
            createAutomationClient,
            spec,
            progressMessage,
            log,
            cancellationToken
        );

    public Task<AutomationWorkItemStatus> WaitForTerminalAsync(
        SubmittedDesignAutomationWorkItem submission,
        DateTime deadlineUtc,
        CancellationToken cancellationToken
    ) =>
        this._workItemRunner.WaitForTerminalAsync(createAutomationClient, submission, deadlineUtc, cancellationToken);

    public Task<AutomationWorkItemStatus> GetStatusAsync(
        string workItemId,
        CancellationToken cancellationToken
    ) =>
        createAutomationClient().GetWorkItemStatusAsync(workItemId, cancellationToken);

    public Task<IReadOnlyList<AutomationWorkItemStatus>> GetStatusesWithFallbackAsync(
        IReadOnlyCollection<string> workItemIds,
        Action<string>? log,
        CancellationToken cancellationToken
    ) =>
        DesignAutomationBatchWorkItemRunner.GetLatestStatusesAsync(workItemIds, createAutomationClient, log, cancellationToken);

    public async Task<string> GetReportContentAsync(
        string? reportUrl,
        CancellationToken cancellationToken
    ) {
        if (string.IsNullOrWhiteSpace(reportUrl))
            throw new InvalidOperationException("Automation workitem status did not include a report URL.");

        var report = await createAutomationClient().GetWorkItemReportAsync(reportUrl, cancellationToken)
            .ConfigureAwait(false);
        return report.ReportContent ?? "";
    }

    public Task RunBatchGroupAsync<TEntry, TTracker, TResult>(
        IReadOnlyCollection<TEntry> entries,
        int maxConcurrency,
        int timeoutSeconds,
        Func<TEntry, Task<DesignAutomationBatchSubmission<TTracker, TResult>>> submitAsync,
        Func<TTracker, AutomationWorkItemStatus, Task<TResult>> finalizeAsync,
        Func<TTracker, int, TResult> buildTimedOutResult,
        Action<string>? log,
        ICollection<TResult> results,
        CancellationToken cancellationToken
    ) where TTracker : IDesignAutomationBatchWorkItemTracker =>
        this._batchRunner.RunGroupAsync(
            entries,
            maxConcurrency,
            timeoutSeconds,
            submitAsync,
            finalizeAsync,
            buildTimedOutResult,
            createAutomationClient,
            log,
            results,
            cancellationToken
        );

    public Task<DesignAutomationArtifactFinalization<TArtifact>> FinalizeJsonArtifactAsync<TArtifact>(
        string workItemId,
        AutomationWorkItemStatus status,
        RefreshingApsTokenLease artifactTokenLease,
        string bucketKey,
        string objectKey,
        string artifactPath,
        string invalidArtifactMessage,
        Action<string>? log,
        CancellationToken cancellationToken
    ) =>
        this._artifactFinalizer.FinalizeJsonArtifactAsync<TArtifact>(
            workItemId,
            status,
            createAutomationClient,
            artifactTokenLease,
            bucketKey,
            objectKey,
            artifactPath,
            invalidArtifactMessage,
            log,
            cancellationToken
        );
}
