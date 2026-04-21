namespace Pe.Dev.RevitAutomation;

public sealed class AutomationWorkItemInspectResult {
    public string WorkItemId { get; init; } = string.Empty;
    public string? Status { get; init; }
    public string? ReportUrl { get; init; }
    public bool ReportFetched { get; init; }
    public string? Classification { get; init; }
    public string? DocumentTitle { get; init; }
    public string? FailureMessage { get; init; }
    public string? ArtifactLocalName { get; init; }
    public string? RawReportExcerpt { get; init; }
}
