namespace Pe.Dev.RevitAutomation;

public sealed class ProbeAccessResult {
    public bool Succeeded { get; init; }
    public ProbeAccessClassification Classification { get; init; }
    public string? WorkItemId { get; init; }
    public string Engine { get; init; } = "";
    public string Region { get; init; } = "";
    public string ProjectGuid { get; init; } = "";
    public string ModelGuid { get; init; } = "";
    public string? DocumentTitle { get; init; }
    public string? FailureMessage { get; init; }
    public string? RawReportExcerpt { get; init; }
}
