using Pe.Shared.RevitAutomation;
using Pe.Shared.ApsAuth;
using Newtonsoft.Json;
using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitData;
using Pe.Shared.RevitVersions;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationParameterCollectionService {
    private readonly AutomationShellDeploymentService _shellDeployment = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();
    private readonly AutomationArtifactFinalizer _artifactFinalizer = new();

    public async Task<ParameterCollectionResult> RunAsync(
        ParameterCollectionOptions options,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var spec = RevitVersionCatalog.RequireByAutomationEngine(options.Engine);
        var settings = RevitAutomationSettings.Load(RevitAutomationApsCredentials.GetConfiguredWebClientId());
        var aps = RevitAutomationApsCredentials.CreateAps();
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
            return BuildFailure(options, ParameterCollectionClassification.ManagementTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring delegated user token");
            _ = userTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.UserTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring artifact token");
            _ = artifactTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.ArtifactTokenFailed, ex.Message);
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
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, ex.Message);
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
            return BuildFailure(options, ParameterCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        var input = new AutomationJobInput {
            JobType = AutomationJobType.ParameterCollection,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            RunId = runId,
            ExpectedTitle = options.ExpectedTitle,
            ParameterCollection = new ParameterCollectionRequest(options.Filter)
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
                    "Automation: submitting parameter collection workitem",
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, ex.Message);
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
            return new ParameterCollectionResult {
                Succeeded = false,
                Classification = ParameterCollectionClassification.TimedOut,
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

        var finalized = await this._artifactFinalizer.FinalizeAsync<ParameterCollectionArtifact>(
                submission.Id,
                status,
                createAutomationClient,
                artifactTokenLease,
                bucketKey,
                objectKey,
                artifactPath,
                "Downloaded parameter collection artifact was unreadable JSON.",
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        return finalized.Status switch {
            AutomationArtifactFinalizationStatus.ReportFetchFailed => new ParameterCollectionResult {
                Succeeded = false,
                Classification = ParameterCollectionClassification.CollectionFailed,
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
                BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ParameterCollectionClassification.ArtifactDownloadFailed),
            AutomationArtifactFinalizationStatus.ArtifactValidationFailed =>
                BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ParameterCollectionClassification.ArtifactValidationFailed),
            AutomationArtifactFinalizationStatus.Success => new ParameterCollectionResult {
                Succeeded = true,
                Classification = ParameterCollectionClassification.Success,
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
            _ => BuildArtifactFailure(options, submission.Id, bucketKey, objectKey, artifactPath, finalized, ParameterCollectionClassification.CollectionFailed)
        };
    }


    private static string BuildArtifactObjectKey(ParameterCollectionOptions options, string runId) =>
        AutomationRunOrchestrator.BuildArtifactObjectKey(
            AutomationJobType.ParameterCollection,
            options.Region,
            options.ProjectGuid,
            options.ModelGuid,
            runId
        );

    private static ParameterCollectionResult BuildFailure(
        ParameterCollectionOptions options,
        ParameterCollectionClassification classification,
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

    private static ParameterCollectionResult BuildArtifactFailure(
        ParameterCollectionOptions options,
        string workItemId,
        string bucketKey,
        string objectKey,
        string artifactPath,
        AutomationArtifactFinalization<ParameterCollectionArtifact> finalized,
        ParameterCollectionClassification classification
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

    private static ParameterCollectionResult BuildReportFailure(
        ParameterCollectionOptions options,
        string workItemId,
        string bucketKey,
        string objectKey,
        string artifactPath,
        ParsedAutomationJobReport parsedReport
    ) {
        var classification = parsedReport.Classification switch {
            nameof(ProbeAccessClassification.CloudModelUnauthorized) or "CloudModelUnauthorized" =>
                ParameterCollectionClassification.CloudModelUnauthorized,
            nameof(ProbeAccessClassification.CloudModelNotFound) or "CloudModelNotFound" =>
                ParameterCollectionClassification.CloudModelNotFound,
            nameof(ProbeAccessClassification.ExpectedTitleMismatch) or "ExpectedTitleMismatch" =>
                ParameterCollectionClassification.ExpectedTitleMismatch,
            _ => ParameterCollectionClassification.CollectionFailed
        };

        return new ParameterCollectionResult {
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

