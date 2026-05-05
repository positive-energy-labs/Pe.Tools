using Pe.Aps.Auth;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationWorkItemInspectorService {
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<AutomationWorkItemInspectResult> RunAsync(
        AutomationWorkItemInspectOptions options,
        CancellationToken cancellationToken
    ) {
        var designAutomation = new ApsCredentialSource().CreateAps().DesignAutomation();

        var status = await designAutomation.GetStatusAsync(options.WorkItemId, cancellationToken)
            .ConfigureAwait(false);

        var result = new AutomationWorkItemInspectResult {
            WorkItemId = status.Id ?? options.WorkItemId, Status = status.Status, ReportUrl = status.ReportUrl
        };

        if (!options.IncludeReport || string.IsNullOrWhiteSpace(status.ReportUrl))
            return result;

        var reportContent = await designAutomation.GetReportContentAsync(status.ReportUrl, cancellationToken)
            .ConfigureAwait(false);
        var parsed = this._reportParser.Parse(reportContent);
        return new AutomationWorkItemInspectResult {
            WorkItemId = status.Id ?? options.WorkItemId,
            Status = status.Status,
            ReportUrl = status.ReportUrl,
            ReportFetched = true,
            Classification = parsed.Classification,
            DocumentTitle = parsed.DocumentTitle,
            FailureMessage = parsed.FailureMessage,
            ArtifactLocalName = parsed.ArtifactLocalName,
            RawReportExcerpt = parsed.RawExcerpt
        };
    }
}
