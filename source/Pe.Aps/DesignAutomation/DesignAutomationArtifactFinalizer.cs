using Pe.Aps.Auth;
using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public sealed class DesignAutomationArtifactFinalizer {
    public async Task<DesignAutomationArtifactFinalization<TArtifact>> FinalizeJsonArtifactAsync<TArtifact>(
        string workItemId,
        AutomationWorkItemStatus status,
        Func<AutomationApiClient> createAutomationClient,
        RefreshingApsTokenLease artifactTokenLease,
        string bucketKey,
        string objectKey,
        string artifactPath,
        string invalidArtifactMessage,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        string? reportContent = null;
        try {
            var report = await createAutomationClient().GetWorkItemReportAsync(status.ReportUrl, cancellationToken)
                .ConfigureAwait(false);
            reportContent = report.ReportContent;
        } catch (Exception ex) {
            if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase))
                return DesignAutomationArtifactFinalization<TArtifact>.ReportFetchFailed(
                    $"Automation report fetch failed for workitem '{workItemId}': {ex.Message}"
                );

            log?.Invoke(
                $"Automation: report fetch failed for workitem {workItemId}; attempting artifact download anyway. {ex.Message}");
        }

        if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase))
            return DesignAutomationArtifactFinalization<TArtifact>.ReportedFailure(reportContent);

        try {
            await new ObjectStorageApiClient(artifactTokenLease.GetAccessToken()).DownloadObjectAsync(
                    bucketKey,
                    objectKey,
                    artifactPath,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return DesignAutomationArtifactFinalization<TArtifact>.ArtifactDownloadFailed(ex.Message, reportContent);
        }

        try {
            var artifact = await DesignAutomationRunHelpers.ReadJsonArtifactAsync<TArtifact>(
                    artifactPath,
                    invalidArtifactMessage,
                    cancellationToken
                )
                .ConfigureAwait(false);
            return DesignAutomationArtifactFinalization<TArtifact>.Success(artifact, reportContent);
        } catch (Exception ex) {
            return DesignAutomationArtifactFinalization<TArtifact>.ArtifactValidationFailed(ex.Message, reportContent);
        }
    }
}

public enum DesignAutomationArtifactFinalizationStatus {
    ReportFetchFailed,
    ReportedFailure,
    ArtifactDownloadFailed,
    ArtifactValidationFailed,
    Success
}

public sealed class DesignAutomationArtifactFinalization<TArtifact> {
    public DesignAutomationArtifactFinalizationStatus Status { get; private init; }
    public string? ReportContent { get; private init; }
    public TArtifact? Artifact { get; private init; }
    public string? FailureMessage { get; private init; }

    public static DesignAutomationArtifactFinalization<TArtifact> ReportFetchFailed(string failureMessage) => new() {
        Status = DesignAutomationArtifactFinalizationStatus.ReportFetchFailed,
        FailureMessage = failureMessage
    };

    public static DesignAutomationArtifactFinalization<TArtifact> ReportedFailure(string? reportContent) => new() {
        Status = DesignAutomationArtifactFinalizationStatus.ReportedFailure,
        ReportContent = reportContent
    };

    public static DesignAutomationArtifactFinalization<TArtifact> ArtifactDownloadFailed(
        string failureMessage,
        string? reportContent
    ) => new() {
        Status = DesignAutomationArtifactFinalizationStatus.ArtifactDownloadFailed,
        FailureMessage = failureMessage,
        ReportContent = reportContent
    };

    public static DesignAutomationArtifactFinalization<TArtifact> ArtifactValidationFailed(
        string failureMessage,
        string? reportContent
    ) => new() {
        Status = DesignAutomationArtifactFinalizationStatus.ArtifactValidationFailed,
        FailureMessage = failureMessage,
        ReportContent = reportContent
    };

    public static DesignAutomationArtifactFinalization<TArtifact> Success(
        TArtifact artifact,
        string? reportContent
    ) => new() {
        Status = DesignAutomationArtifactFinalizationStatus.Success,
        Artifact = artifact,
        ReportContent = reportContent
    };
}
