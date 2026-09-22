using Pe.Shared.RevitData.Schedules;

namespace Pe.Dev.RevitAutomation;

public sealed record ScheduleCollectionOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json,
    ScheduleCollectionRequest? Request = null
) {
    public const string DefaultEngine = ParameterCollectionOptions.DefaultEngine;
    public const int DefaultTimeoutSeconds = ParameterCollectionOptions.DefaultTimeoutSeconds;
}

public enum ScheduleCollectionClassification {
    Success,
    ManagementTokenFailed,
    UserTokenFailed,
    ArtifactTokenFailed,
    WorkItemSubmissionUnauthorized,
    WorkItemSubmissionFailed,
    CloudModelUnauthorized,
    CloudModelNotFound,
    ExpectedTitleMismatch,
    CollectionFailed,
    ArtifactDownloadFailed,
    ArtifactValidationFailed,
    TimedOut
}

public sealed class ScheduleCollectionResult {
    public bool Succeeded { get; init; }
    public ScheduleCollectionClassification Classification { get; init; }
    public string? WorkItemId { get; init; }
    public string Engine { get; init; } = "";
    public string Region { get; init; } = "";
    public string ProjectGuid { get; init; } = "";
    public string ModelGuid { get; init; } = "";
    public string? DocumentTitle { get; init; }
    public string? FailureMessage { get; init; }
    public string? RawReportExcerpt { get; init; }
    public string? ArtifactBucketKey { get; init; }
    public string? ArtifactObjectKey { get; init; }
    public string? ArtifactLocalPath { get; init; }
}
