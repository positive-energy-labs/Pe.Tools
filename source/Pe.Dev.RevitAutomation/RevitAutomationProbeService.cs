using Pe.Shared.RevitAutomation;
using Pe.Shared.ApsAuth;
using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitVersions;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationProbeService {
    private readonly AutomationShellDeploymentService _shellDeployment = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<ProbeAccessResult> RunAsync(
        ProbeAccessOptions options,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var spec = RevitVersionCatalog.RequireByAutomationEngine(options.Engine);
        var credentialSource = new ApsCredentialSource();
        var settings = RevitAutomationSettings.Load(credentialSource.GetConfiguredWebClientId());
        var aps = credentialSource.CreateAps();
        var createAutomationClient = aps.Automation;
        var userTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext())
        );

        try {
            log?.Invoke("Auth: acquiring management token");
            _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.ManagementTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring delegated user token");
            _ = userTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.UserTokenFailed, ex.Message);
        }

        ResolvedAutomationShellIds shellIds;
        try {
            shellIds = await this._shellDeployment.EnsureReadyAsync(
                    repoRoot,
                    settings,
                    spec,
                    createAutomationClient,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
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

        SubmittedDesignAutomationWorkItem submission;
        try {
            submission = await this._workItemRunner.SubmitAsync(
                    createAutomationClient,
                    new AutomationWorkItemSpec {
                        ActivityId = shellIds.QualifiedActivityAlias,
                        LimitProcessingTimeSec = options.TimeoutSeconds,
                        Debug = options.Debug,
                        Arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
                            ["inputParams"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                                ["url"] =
                                    DesignAutomationWorkItemArguments.BuildJsonDataUrl(probeInput.ToJson())
                            },
                            ["adsk3LeggedToken"] = userTokenLease.GetAccessToken()
                        }
                    },
                    "Automation: submitting workitem",
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ProbeAccessClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
        var status = await this._workItemRunner.WaitForTerminalAsync(
                createAutomationClient,
                submission,
                deadline,
                cancellationToken
            )
            .ConfigureAwait(false);

        if (!DesignAutomationRunHelpers.IsTerminal(status.Status)) {
            return new ProbeAccessResult {
                Succeeded = false,
                Classification = ProbeAccessClassification.TimedOut,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage =
                    $"Automation workitem '{submission.Id}' timed out after {options.TimeoutSeconds} seconds."
            };
        }

        var reportContent = await aps.DesignAutomation().GetReportContentAsync(status.ReportUrl, cancellationToken)
            .ConfigureAwait(false);
        var parsedReport = this._reportParser.Parse(reportContent);
        var classification = parsedReport.Classification switch {
            nameof(ProbeAccessClassification.Success) or "Success" => ProbeAccessClassification.Success,
            nameof(ProbeAccessClassification.CloudModelUnauthorized) or "CloudModelUnauthorized" =>
                ProbeAccessClassification.CloudModelUnauthorized,
            nameof(ProbeAccessClassification.CloudModelNotFound) or "CloudModelNotFound" =>
                ProbeAccessClassification.CloudModelNotFound,
            nameof(ProbeAccessClassification.ExpectedTitleMismatch) or "ExpectedTitleMismatch" =>
                ProbeAccessClassification.ExpectedTitleMismatch,
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

}
