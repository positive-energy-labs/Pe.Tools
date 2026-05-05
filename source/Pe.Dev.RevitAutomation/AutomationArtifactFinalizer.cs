using Pe.Aps.Auth;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationArtifactFinalizer {
    private readonly DesignAutomationArtifactFinalizer _artifactFinalizer = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<AutomationArtifactFinalization<TArtifact>> FinalizeAsync<TArtifact>(
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
        var finalized = await this._artifactFinalizer.FinalizeJsonArtifactAsync<TArtifact>(
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
            )
            .ConfigureAwait(false);

        var parsedReport = this.ParseReport(finalized.ReportContent);

        return finalized.Status switch {
            DesignAutomationArtifactFinalizationStatus.ReportFetchFailed =>
                AutomationArtifactFinalization<TArtifact>.ReportFetchFailed(finalized.FailureMessage ?? "Automation report fetch failed."),
            DesignAutomationArtifactFinalizationStatus.ReportedFailure =>
                AutomationArtifactFinalization<TArtifact>.ReportedFailure(parsedReport ?? new ParsedAutomationJobReport()),
            DesignAutomationArtifactFinalizationStatus.ArtifactDownloadFailed =>
                AutomationArtifactFinalization<TArtifact>.ArtifactDownloadFailed(finalized.FailureMessage, parsedReport),
            DesignAutomationArtifactFinalizationStatus.ArtifactValidationFailed =>
                AutomationArtifactFinalization<TArtifact>.ArtifactValidationFailed(finalized.FailureMessage, parsedReport),
            DesignAutomationArtifactFinalizationStatus.Success when finalized.Artifact != null =>
                AutomationArtifactFinalization<TArtifact>.Success(finalized.Artifact, parsedReport),
            _ => AutomationArtifactFinalization<TArtifact>.ArtifactValidationFailed(
                "Automation artifact finalization did not return an artifact.",
                parsedReport
            )
        };
    }

    private ParsedAutomationJobReport? ParseReport(string? reportContent) =>
        string.IsNullOrWhiteSpace(reportContent) ? null : this._reportParser.Parse(reportContent);
}

internal enum AutomationArtifactFinalizationStatus {
    ReportFetchFailed,
    ReportedFailure,
    ArtifactDownloadFailed,
    ArtifactValidationFailed,
    Success
}

internal sealed class AutomationArtifactFinalization<TArtifact> {
    public AutomationArtifactFinalizationStatus Status { get; private init; }
    public ParsedAutomationJobReport? ParsedReport { get; private init; }
    public TArtifact? Artifact { get; private init; }
    public string? FailureMessage { get; private init; }

    public static AutomationArtifactFinalization<TArtifact> ReportFetchFailed(string failureMessage) => new() {
        Status = AutomationArtifactFinalizationStatus.ReportFetchFailed,
        FailureMessage = failureMessage
    };

    public static AutomationArtifactFinalization<TArtifact> ReportedFailure(ParsedAutomationJobReport parsedReport) => new() {
        Status = AutomationArtifactFinalizationStatus.ReportedFailure,
        ParsedReport = parsedReport
    };

    public static AutomationArtifactFinalization<TArtifact> ArtifactDownloadFailed(
        string? failureMessage,
        ParsedAutomationJobReport? parsedReport
    ) => new() {
        Status = AutomationArtifactFinalizationStatus.ArtifactDownloadFailed,
        FailureMessage = failureMessage,
        ParsedReport = parsedReport
    };

    public static AutomationArtifactFinalization<TArtifact> ArtifactValidationFailed(
        string? failureMessage,
        ParsedAutomationJobReport? parsedReport
    ) => new() {
        Status = AutomationArtifactFinalizationStatus.ArtifactValidationFailed,
        FailureMessage = failureMessage,
        ParsedReport = parsedReport
    };

    public static AutomationArtifactFinalization<TArtifact> Success(
        TArtifact artifact,
        ParsedAutomationJobReport? parsedReport
    ) => new() {
        Status = AutomationArtifactFinalizationStatus.Success,
        Artifact = artifact,
        ParsedReport = parsedReport
    };
}
