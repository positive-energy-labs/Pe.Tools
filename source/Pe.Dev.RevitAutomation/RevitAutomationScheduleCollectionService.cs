using Newtonsoft.Json;
using Pe.Shared.Aps;
using Pe.Shared.Aps.Models;
using Pe.Shared.RevitData.Schedules;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationScheduleCollectionService {
    private readonly RevitAutomationWorkerBundleBuilder _bundleBuilder = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<ScheduleCollectionResult> RunAsync(
        ScheduleCollectionOptions options,
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
            return BuildFailure(options, ScheduleCollectionClassification.ManagementTokenFailed, ex.Message);
        }

        ApsTokenResult userToken;
        try {
            log?.Invoke("Auth: acquiring delegated user token");
            userToken = aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext());
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.UserTokenFailed, ex.Message);
        }

        ApsTokenResult artifactToken;
        try {
            log?.Invoke("Auth: acquiring artifact token");
            artifactToken = aps.GetTokenResult(new ApsTokenRequest {
                FlowKind = ApsAuthFlowKind.TwoLegged,
                ExplicitScopes = ["bucket:create", "bucket:read", "data:read", "data:write"]
            });
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        WorkerBundleArtifact bundle;
        try {
            bundle = await this._bundleBuilder.BuildAsync(repoRoot, options.Engine, log, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message);
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
        } catch (HttpRequestException ex) when
            (ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var objectStorage = new AutomationObjectStorageClient(artifactToken.AccessToken);
        var bucketKey = settings.BuildArtifactBucketKey();
        var runId = Guid.NewGuid().ToString("D");
        var objectKey = BuildArtifactObjectKey(options, runId);
        var artifactPath = BuildArtifactLocalPath(repoRoot, options.Engine, objectKey);

        try {
            log?.Invoke($"Artifacts: ensuring OSS bucket {bucketKey}");
            await objectStorage.EnsureTransientBucketAsync(bucketKey, cancellationToken).ConfigureAwait(false);
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

        AutomationWorkItemStatus submission;
        try {
            log?.Invoke("Automation: submitting schedule collection workitem");
            submission = await automationClient.SubmitWorkItemAsync(
                    new AutomationWorkItemSpec {
                        ActivityId = $"{settings.Namespace}.{settings.ActivityId}+{settings.AliasId}",
                        LimitProcessingTimeSec = options.TimeoutSeconds,
                        Debug = options.Debug,
                        Arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
                            ["inputParams"] =
                                new Dictionary<string, object>(StringComparer.Ordinal) {
                                    ["url"] = RevitAutomationParameterCollectionService.BuildJsonDataUrl(input.ToJson())
                                },
                            ["resultJson"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                                ["verb"] = "put",
                                ["url"] = objectStorage.BuildObjectUrn(bucketKey, objectKey),
                                ["headers"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                                    ["Authorization"] = $"Bearer {artifactToken.AccessToken}"
                                }
                            },
                            ["adsk3LeggedToken"] = userToken.AccessToken
                        }
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message);
        }

        if (string.IsNullOrWhiteSpace(submission.Id))
            return BuildFailure(options, ScheduleCollectionClassification.WorkItemSubmissionFailed,
                "Automation workitem submission did not return an id.");

        log?.Invoke($"Automation: workitem {submission.Id}");
        var deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
        var status = submission;
        while (!RevitAutomationParameterCollectionService.IsTerminal(status.Status) && DateTime.UtcNow < deadline) {
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            status = await automationClient.GetWorkItemStatusAsync(submission.Id, cancellationToken)
                .ConfigureAwait(false);
        }

        if (!RevitAutomationParameterCollectionService.IsTerminal(status.Status)) {
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

        var report = await automationClient.GetWorkItemReportAsync(status.ReportUrl, cancellationToken)
            .ConfigureAwait(false);
        var parsedReport = this._reportParser.Parse(report.ReportContent);
        if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase))
            return BuildReportFailure(options, submission.Id, bucketKey, objectKey, artifactPath, parsedReport);

        try {
            log?.Invoke($"Artifacts: downloading {bucketKey}/{objectKey}");
            await objectStorage.DownloadObjectAsync(bucketKey, objectKey, artifactPath, cancellationToken)
                .ConfigureAwait(false);
            _ = JsonConvert.DeserializeObject<ScheduleCollectionArtifact>(
                    await File.ReadAllTextAsync(artifactPath, cancellationToken).ConfigureAwait(false))
                ?? throw new InvalidDataException("Downloaded schedule collection artifact was unreadable JSON.");
        } catch (Exception ex) {
            return new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.ArtifactDownloadFailed,
                WorkItemId = submission.Id,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                DocumentTitle = parsedReport.DocumentTitle,
                FailureMessage = ex.Message,
                RawReportExcerpt = parsedReport.RawExcerpt,
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath
            };
        }

        return new ScheduleCollectionResult {
            Succeeded = true,
            Classification = ScheduleCollectionClassification.Success,
            WorkItemId = submission.Id,
            Engine = options.Engine,
            Region = options.Region,
            ProjectGuid = options.ProjectGuid,
            ModelGuid = options.ModelGuid,
            DocumentTitle = parsedReport.DocumentTitle,
            RawReportExcerpt = parsedReport.RawExcerpt,
            ArtifactBucketKey = bucketKey,
            ArtifactObjectKey = objectKey,
            ArtifactLocalPath = artifactPath
        };
    }

    private static string BuildArtifactObjectKey(ScheduleCollectionOptions options, string runId) {
        var region = options.Region.Trim().ToUpperInvariant();
        var projectGuid = options.ProjectGuid.Trim().ToLowerInvariant();
        var modelGuid = options.ModelGuid.Trim().ToLowerInvariant();
        return $"schedule-collections/{DateTime.UtcNow:yyyy/MM/dd}/{region}/{projectGuid}/{modelGuid}/{runId}.json";
    }

    private static string BuildArtifactLocalPath(string repoRoot, string engine, string objectKey) =>
        Path.Combine(
            repoRoot,
            ".artifacts",
            "automation",
            "results",
            RevitAutomationParameterCollectionService.ResolveEngineYear(engine).ToString(),
            Path.GetFileName(objectKey)
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