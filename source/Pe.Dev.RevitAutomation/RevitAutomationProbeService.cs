using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.Aps.Models;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationProbeService {
    private readonly RevitAutomationWorkerBundleBuilder _bundleBuilder = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<ProbeAccessResult> RunAsync(
        ProbeAccessOptions options,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var authProvider = new StoredApsWebAuthTokenProvider();
        var settings = RevitAutomationSettings.Load(authProvider.GetClientId());
        var aps = new Aps(authProvider);

        try {
            log?.Invoke("Auth: acquiring management token");
            _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.ManagementTokenFailed, ex.Message);
        }

        ApsTokenResult userToken;
        try {
            log?.Invoke("Auth: acquiring delegated user token");
            userToken = aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext());
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.UserTokenFailed, ex.Message);
        }

        WorkerBundleArtifact bundle;
        try {
            bundle = await this._bundleBuilder.BuildAsync(repoRoot, options.Engine, log, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var automationClient = aps.Automation();
        try {
            await RevitAutomationParameterCollectionService.EnsureShellReadyAsync(
                    automationClient,
                    settings,
                    options.Engine,
                    bundle.PackageContents,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var probeInput = AutomationJobInput.ForCloudOpenProbe(
            options.Engine,
            options.Region,
            options.ProjectGuid,
            options.ModelGuid,
            Guid.NewGuid().ToString("D"),
            options.ExpectedTitle
        );

        AutomationWorkItemStatus submission;
        try {
            log?.Invoke("Automation: submitting workitem");
            submission = await automationClient.SubmitWorkItemAsync(
                    new AutomationWorkItemSpec {
                        ActivityId = $"{settings.Namespace}.{settings.ActivityId}+{settings.AliasId}",
                        LimitProcessingTimeSec = options.TimeoutSeconds,
                        Debug = options.Debug,
                        Arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
                            ["inputParams"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                                ["url"] = RevitAutomationParameterCollectionService.BuildJsonDataUrl(probeInput.ToJson())
                            },
                            ["adsk3LeggedToken"] = userToken.AccessToken
                        }
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionFailed, ex.Message);
        }

        if (string.IsNullOrWhiteSpace(submission.Id))
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionFailed, "Automation workitem submission did not return an id.");

        log?.Invoke($"Automation: workitem {submission.Id}");
        var deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
        AutomationWorkItemStatus status = submission;
        while (!IsTerminal(status.Status) && DateTime.UtcNow < deadline) {
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            status = await automationClient.GetWorkItemStatusAsync(submission.Id, cancellationToken).ConfigureAwait(false);
        }

        if (!IsTerminal(status.Status)) {
            return new ProbeAccessResult {
                Succeeded = false,
                Classification = ProbeAccessClassification.TimedOut,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage = $"Automation workitem '{submission.Id}' timed out after {options.TimeoutSeconds} seconds."
            };
        }

        var report = await automationClient.GetWorkItemReportAsync(status.ReportUrl, cancellationToken).ConfigureAwait(false);
        var parsedReport = this._reportParser.Parse(report.ReportContent);
        var classification = parsedReport.Classification switch {
            nameof(ProbeAccessClassification.Success) or "Success" => ProbeAccessClassification.Success,
            nameof(ProbeAccessClassification.CloudModelUnauthorized) or "CloudModelUnauthorized" =>
                ProbeAccessClassification.CloudModelUnauthorized,
            nameof(ProbeAccessClassification.CloudModelNotFound) or "CloudModelNotFound" =>
                ProbeAccessClassification.CloudModelNotFound,
            _ => ProbeAccessClassification.CloudModelOpenFailed
        };
        return new ProbeAccessResult {
            Succeeded = classification == ProbeAccessClassification.Success,
            Classification = classification,
            WorkItemId = submission.Id,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            DocumentTitle = parsedReport.DocumentTitle,
            FailureMessage = parsedReport.FailureMessage,
            RawReportExcerpt = parsedReport.RawExcerpt
        };
    }

    private static ProbeAccessResult BuildFailure(
        ProbeAccessOptions options,
        ProbeAccessClassification classification,
        string? failureMessage
    ) =>
        new() {
            Succeeded = false,
            Classification = classification,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            FailureMessage = failureMessage
        };

    private static bool IsTerminal(string? status) =>
        status is not null &&
        (
            status.Equals("success", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("failed", StringComparison.OrdinalIgnoreCase) ||
            status.StartsWith("failed", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("cancelled", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("timeout", StringComparison.OrdinalIgnoreCase)
        );
}
