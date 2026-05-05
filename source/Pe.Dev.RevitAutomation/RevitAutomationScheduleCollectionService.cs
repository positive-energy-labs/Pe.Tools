using Pe.Shared.RevitAutomation;
using Pe.Shared.ApsAuth;
using Newtonsoft.Json;
using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.RevitVersions;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationScheduleCollectionService {
    private readonly AutomationShellDeploymentService _shellDeployment = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();
    private readonly AutomationArtifactFinalizer _artifactFinalizer = new();

    public async Task<ScheduleCollectionResult> RunAsync(
        ScheduleCollectionOptions options,
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
        var artifactTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForAutomationArtifactStorage())
        );

        try {
            log?.Invoke("Auth: acquiring management token");
            _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.ManagementTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring delegated user token");
            _ = userTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.UserTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring artifact token");
            _ = artifactTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.ArtifactTokenFailed, ex.Message);
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
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var bucketKey = settings.BuildArtifactBucketKey();
        var runId = Guid.NewGuid().ToString("D");
        var objectKey = BuildArtifactObjectKey(options, runId);
        var artifactPath = AutomationDevRunHelpers.BuildArtifactLocalPath(repoRoot, spec.Year, objectKey);

        try {
            log?.Invoke($"Artifacts: ensuring OSS bucket {bucketKey}");
            await new ObjectStorageApiClient(artifactTokenLease.GetAccessToken())
                .EnsureTransientBucketAsync(bucketKey, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        var input = new AutomationJobInput {
            JobType = AutomationJobType.ScheduleCollection,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            RunId = runId,
            ExpectedTitle = options.ExpectedTitle,
            ScheduleCollection = options.Request ?? ScheduleCollectionDefaults.CreateDefaultRequest()
        };

        SubmittedDesignAutomationWorkItem submission;
        try {
            var artifactToken = artifactTokenLease.GetAccessToken();
            submission = await this._workItemRunner.SubmitAsync(
                    createAutomationClient,
                    new AutomationWorkItemSpec {
                        ActivityId = shellIds.QualifiedActivityAlias,
                        LimitProcessingTimeSec = options.TimeoutSeconds,
                        Debug = options.Debug,
                        Arguments = AutomationRunOrchestrator.BuildWorkItemArguments(
                            input,
                            bucketKey,
                            objectKey,
                            artifactToken,
                            userTokenLease.GetAccessToken()
                        )
                    },
                    "Automation: submitting schedule collection workitem",
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message);
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
            return new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.TimedOut,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath,
                FailureMessage =
                    $"Automation workitem '{submission.Id}' timed out after {options.TimeoutSeconds} seconds."
            };
        }

        var finalized = await this._artifactFinalizer.FinalizeAsync<ScheduleCollectionArtifact>(
                submission.Id,
                status,
                createAutomationClient,
                artifactTokenLease,
                bucketKey,
                objectKey,
                artifactPath,
                "Downloaded schedule collection artifact was unreadable JSON.",
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        return finalized.Status switch {
            AutomationArtifactFinalizationStatus.ReportFetchFailed => new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.CollectionFailed,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage = finalized.FailureMessage,
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath
            },
            AutomationArtifactFinalizationStatus.ReportedFailure =>
                BuildReportFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized.ParsedReport ?? new ParsedAutomationJobReport()),
            AutomationArtifactFinalizationStatus.ArtifactDownloadFailed =>
                BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ScheduleCollectionClassification.ArtifactDownloadFailed),
            AutomationArtifactFinalizationStatus.ArtifactValidationFailed =>
                BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ScheduleCollectionClassification.ArtifactValidationFailed),
            AutomationArtifactFinalizationStatus.Success => new ScheduleCollectionResult {
                Succeeded = true,
                Classification = ScheduleCollectionClassification.Success,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                DocumentTitle = finalized.ParsedReport?.DocumentTitle ?? finalized.Artifact?.DocumentTitle,
                RawReportExcerpt = finalized.ParsedReport?.RawExcerpt,
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath
            },
            _ => BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ScheduleCollectionClassification.CollectionFailed)
        };
    }

    private static string BuildArtifactObjectKey(ScheduleCollectionOptions options, string runId) =>
        AutomationRunOrchestrator.BuildArtifactObjectKey(
            AutomationJobType.ScheduleCollection,
            options.Region,
            options.ProjectGuid,
            options.ModelGuid,
            runId
        );

    private static ScheduleCollectionResult BuildFailure(
        ScheduleCollectionOptions options,
        ScheduleCollectionClassification classification,
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

    private static ScheduleCollectionResult BuildArtifactFailure(
        ScheduleCollectionOptions options,
        string workItemId,
        string bucketKey,
        string objectKey,
        string artifactPath,
        AutomationArtifactFinalization<ScheduleCollectionArtifact> finalized,
        ScheduleCollectionClassification classification
    ) =>
        new() {
            Succeeded = false,
            Classification = classification,
            WorkItemId = workItemId,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            DocumentTitle = finalized.ParsedReport?.DocumentTitle,
            FailureMessage = finalized.FailureMessage,
            RawReportExcerpt = finalized.ParsedReport?.RawExcerpt,
            ArtifactBucketKey = bucketKey,
            ArtifactObjectKey = objectKey,
            ArtifactLocalPath = artifactPath
        };

    private static ScheduleCollectionResult BuildReportFailure(
        ScheduleCollectionOptions options,
        string workItemId,
        string bucketKey,
        string objectKey,
        string artifactPath,
        ParsedAutomationJobReport parsedReport
    ) {
        var classification = parsedReport.Classification switch {
            nameof(ProbeAccessClassification.CloudModelUnauthorized) or "CloudModelUnauthorized" =>
                ScheduleCollectionClassification.CloudModelUnauthorized,
            nameof(ProbeAccessClassification.CloudModelNotFound) or "CloudModelNotFound" =>
                ScheduleCollectionClassification.CloudModelNotFound,
            nameof(ProbeAccessClassification.ExpectedTitleMismatch) or "ExpectedTitleMismatch" =>
                ScheduleCollectionClassification.ExpectedTitleMismatch,
            _ => ScheduleCollectionClassification.CollectionFailed
        };

        return new ScheduleCollectionResult {
            Succeeded = false,
            Classification = classification,
            WorkItemId = workItemId,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            DocumentTitle = parsedReport.DocumentTitle,
            FailureMessage = parsedReport.FailureMessage,
            RawReportExcerpt = parsedReport.RawExcerpt,
            ArtifactBucketKey = bucketKey,
            ArtifactObjectKey = objectKey,
            ArtifactLocalPath = artifactPath
        };
    }
}

