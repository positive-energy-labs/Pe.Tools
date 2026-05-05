using Pe.Shared.RevitData;

namespace Pe.Dev.RevitAutomation;

public sealed record ParameterCollectionOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json,
    LoadedFamiliesFilter? Filter = null
) {
    public const string DefaultEngine = "Autodesk.Revit+2025";
    public const int DefaultTimeoutSeconds = 1800;
}

public enum ParameterCollectionClassification {
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

public sealed class ParameterCollectionResult {
    public bool Succeeded { get; init; }
    public ParameterCollectionClassification Classification { get; init; }
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
