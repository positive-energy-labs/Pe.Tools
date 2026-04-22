using Pe.Shared.Aps;
using Pe.Shared.Aps.Core;
using Pe.Shared.Aps.Models;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationScheduleCollectionBatchService {
    private readonly RevitAutomationWorkerBundleBuilder _bundleBuilder = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<ScheduleCollectionBatchResult> RunAsync(
        string manifestPath,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var manifest = ScheduleCollectionBatchManifest.LoadFromFile(manifestPath);
        var authProvider = new StoredApsWebAuthTokenProvider();
        var settings = RevitAutomationSettings.Load(authProvider.GetClientId());
        var aps = new Aps(authProvider);

        try {
            log?.Invoke("Auth: acquiring management token");
            _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.ManagementTokenFailed, manifest, ex.Message);
        }

        ApsTokenResult userToken;
        try {
            log?.Invoke("Auth: acquiring delegated user token");
            userToken = aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext());
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.UserTokenFailed, manifest, ex.Message);
        }

        ApsTokenResult artifactToken;
        try {
            log?.Invoke("Auth: acquiring artifact token");
            artifactToken = aps.GetTokenResult(new ApsTokenRequest {
                FlowKind = ApsAuthFlowKind.TwoLegged,
                ExplicitScopes = ["bucket:create", "bucket:read", "data:read", "data:write"]
            });
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.ArtifactTokenFailed, manifest, ex.Message);
        }

        WorkerBundleArtifact bundle;
        try {
            bundle = await this._bundleBuilder.BuildAsync(repoRoot, manifest.Engine, log, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.WorkItemSubmissionFailed, manifest, ex.Message);
        }

        var automationClient = aps.Automation();
        try {
            await RevitAutomationParameterCollectionService.EnsureShellReadyAsync(
                    automationClient,
                    settings,
                    manifest.Engine,
                    bundle.PackageContents,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when
            (ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, manifest, ex.Message);
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.WorkItemSubmissionFailed, manifest, ex.Message);
        }

        var objectStorage = new AutomationObjectStorageClient(artifactToken.AccessToken);
        var bucketKey = settings.BuildArtifactBucketKey();
        try {
            log?.Invoke($"Artifacts: ensuring OSS bucket {bucketKey}");
            await objectStorage.EnsureTransientBucketAsync(bucketKey, cancellationToken).ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, manifest.Models.Count,
                ScheduleCollectionClassification.ArtifactTokenFailed, manifest, ex.Message);
        }

        var pending = new Queue<ScheduleCollectionBatchEntry>(manifest.Models);
        var active = new Dictionary<string, BatchTracker>(StringComparer.Ordinal);
        var results = new List<ScheduleCollectionResult>();
        var maxConcurrency = Math.Max(1, manifest.MaxConcurrency);

        while ((pending.Count > 0 || active.Count > 0) && !cancellationToken.IsCancellationRequested) {
            while (pending.Count > 0 && active.Count < maxConcurrency) {
                var entry = pending.Dequeue();
                var tracker = await this.SubmitAsync(
                        entry,
                        manifest,
                        repoRoot,
                        bucketKey,
                        artifactToken.AccessToken,
                        userToken.AccessToken,
                        settings,
                        automationClient,
                        log,
                        cancellationToken
                    )
                    .ConfigureAwait(false);

                if (tracker.SubmissionFailure != null) {
                    results.Add(tracker.SubmissionFailure);
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(tracker.WorkItemId))
                    active[tracker.WorkItemId] = tracker;
            }

            if (active.Count == 0)
                continue;

            await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken).ConfigureAwait(false);
            var statuses = await automationClient.GetWorkItemStatusesAsync(active.Keys.ToArray(), cancellationToken)
                .ConfigureAwait(false);
            foreach (var status in statuses) {
                if (string.IsNullOrWhiteSpace(status.Id) || !active.TryGetValue(status.Id, out var tracker))
                    continue;

                if (!RevitAutomationParameterCollectionService.IsTerminal(status.Status))
                    continue;

                var finalized = await this.FinalizeAsync(
                        tracker,
                        status,
                        objectStorage,
                        automationClient,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                results.Add(finalized);
                active.Remove(status.Id);
            }
        }

        return new ScheduleCollectionBatchResult {
            ManifestPath = manifestPath,
            TotalModelCount = manifest.Models.Count,
            SuccessCount = results.Count(result => result.Succeeded),
            FailureCount = results.Count(result => !result.Succeeded),
            Results = results
        };
    }

    private async Task<BatchTracker> SubmitAsync(
        ScheduleCollectionBatchEntry entry,
        ScheduleCollectionBatchManifest manifest,
        string repoRoot,
        string bucketKey,
        string artifactAccessToken,
        string userAccessToken,
        RevitAutomationSettings settings,
        AutomationApiClient automationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var options = entry.ToOptions(manifest);
        var runId = Guid.NewGuid().ToString("D");
        var objectKey = BuildArtifactObjectKey(entry, runId);
        var artifactPath = BuildArtifactLocalPath(repoRoot, manifest.Engine, objectKey);
        var input = new AutomationJobInput {
            JobType = AutomationJobType.ScheduleCollection,
            Engine = manifest.Engine,
            Region = entry.Region,
            ProjectGuid = entry.ProjectGuid,
            ModelGuid = entry.ModelGuid,
            RunId = runId,
            ExpectedTitle = entry.ExpectedTitle,
            ScheduleCollection = options.Request ?? ScheduleCollectionDefaults.CreateDefaultRequest()
        };

        try {
            log?.Invoke($"Automation: submitting batch schedule workitem for {entry.ModelGuid}");
            var submission = await automationClient.SubmitWorkItemAsync(
                    new AutomationWorkItemSpec {
                        ActivityId = $"{settings.Namespace}.{settings.ActivityId}+{settings.AliasId}",
                        LimitProcessingTimeSec = manifest.TimeoutSeconds,
                        Debug = manifest.Debug,
                        Arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
                            ["inputParams"] =
                                new Dictionary<string, object>(StringComparer.Ordinal) {
                                    ["url"] = RevitAutomationParameterCollectionService.BuildJsonDataUrl(input.ToJson())
                                },
                            ["resultJson"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                                ["verb"] = "put",
                                ["url"] = $"urn:adsk.objects:os.object:{bucketKey}/{Uri.EscapeDataString(objectKey)}",
                                ["headers"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                                    ["Authorization"] = $"Bearer {artifactAccessToken}"
                                }
                            },
                            ["adsk3LeggedToken"] = userAccessToken
                        }
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);

            if (string.IsNullOrWhiteSpace(submission.Id)) {
                return new BatchTracker {
                    SubmissionFailure = new ScheduleCollectionResult {
                        Succeeded = false,
                        Classification = ScheduleCollectionClassification.WorkItemSubmissionFailed,
                        Engine = options.Engine,
                        Region = options.Region,
                        ProjectGuid = options.ProjectGuid,
                        ModelGuid = options.ModelGuid,
                        ArtifactBucketKey = bucketKey,
                        ArtifactObjectKey = objectKey,
                        ArtifactLocalPath = artifactPath,
                        FailureMessage = "Automation workitem submission did not return an id."
                    }
                };
            }

            return new BatchTracker {
                Options = options,
                WorkItemId = submission.Id,
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath
            };
        } catch (HttpRequestException ex) when
            (ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) {
            return new BatchTracker {
                SubmissionFailure = new ScheduleCollectionResult {
                    Succeeded = false,
                    Classification = ScheduleCollectionClassification.WorkItemSubmissionUnauthorized,
                    Engine = options.Engine,
                    Region = options.Region,
                    ProjectGuid = options.ProjectGuid,
                    ModelGuid = options.ModelGuid,
                    ArtifactBucketKey = bucketKey,
                    ArtifactObjectKey = objectKey,
                    ArtifactLocalPath = artifactPath,
                    FailureMessage = ex.Message
                }
            };
        } catch (Exception ex) {
            return new BatchTracker {
                SubmissionFailure = new ScheduleCollectionResult {
                    Succeeded = false,
                    Classification = ScheduleCollectionClassification.WorkItemSubmissionFailed,
                    Engine = options.Engine,
                    Region = options.Region,
                    ProjectGuid = options.ProjectGuid,
                    ModelGuid = options.ModelGuid,
                    ArtifactBucketKey = bucketKey,
                    ArtifactObjectKey = objectKey,
                    ArtifactLocalPath = artifactPath,
                    FailureMessage = ex.Message
                }
            };
        }
    }

    private async Task<ScheduleCollectionResult> FinalizeAsync(
        BatchTracker tracker,
        AutomationWorkItemStatus status,
        AutomationObjectStorageClient objectStorage,
        AutomationApiClient automationClient,
        CancellationToken cancellationToken
    ) {
        var report = await automationClient.GetWorkItemReportAsync(status.ReportUrl, cancellationToken)
            .ConfigureAwait(false);
        var parsedReport = this._reportParser.Parse(report.ReportContent);
        if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase))
            return BuildFailureResult(tracker, parsedReport, ScheduleCollectionClassification.CollectionFailed);

        try {
            await objectStorage.DownloadObjectAsync(
                    tracker.ArtifactBucketKey,
                    tracker.ArtifactObjectKey,
                    tracker.ArtifactLocalPath,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.ArtifactDownloadFailed,
                WorkItemId = tracker.WorkItemId,
                Engine = tracker.Options.Engine,
                Region = tracker.Options.Region,
                ProjectGuid = tracker.Options.ProjectGuid,
                ModelGuid = tracker.Options.ModelGuid,
                DocumentTitle = parsedReport.DocumentTitle,
                FailureMessage = ex.Message,
                RawReportExcerpt = parsedReport.RawExcerpt,
                ArtifactBucketKey = tracker.ArtifactBucketKey,
                ArtifactObjectKey = tracker.ArtifactObjectKey,
                ArtifactLocalPath = tracker.ArtifactLocalPath
            };
        }

        return new ScheduleCollectionResult {
            Succeeded = true,
            Classification = ScheduleCollectionClassification.Success,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            DocumentTitle = parsedReport.DocumentTitle,
            RawReportExcerpt = parsedReport.RawExcerpt,
            ArtifactBucketKey = tracker.ArtifactBucketKey,
            ArtifactObjectKey = tracker.ArtifactObjectKey,
            ArtifactLocalPath = tracker.ArtifactLocalPath
        };
    }

    private static ScheduleCollectionResult BuildFailureResult(
        BatchTracker tracker,
        ParsedAutomationJobReport parsedReport,
        ScheduleCollectionClassification defaultClassification
    ) {
        var classification = parsedReport.Classification switch {
            nameof(ProbeAccessClassification.CloudModelUnauthorized) or "CloudModelUnauthorized" =>
                ScheduleCollectionClassification.CloudModelUnauthorized,
            nameof(ProbeAccessClassification.CloudModelNotFound) or "CloudModelNotFound" =>
                ScheduleCollectionClassification.CloudModelNotFound,
            _ => defaultClassification
        };

        return new ScheduleCollectionResult {
            Succeeded = false,
            Classification = classification,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            DocumentTitle = parsedReport.DocumentTitle,
            FailureMessage = parsedReport.FailureMessage,
            RawReportExcerpt = parsedReport.RawExcerpt,
            ArtifactBucketKey = tracker.ArtifactBucketKey,
            ArtifactObjectKey = tracker.ArtifactObjectKey,
            ArtifactLocalPath = tracker.ArtifactLocalPath
        };
    }

    private static ScheduleCollectionBatchResult BuildPreflightFailure(
        string manifestPath,
        int totalModelCount,
        ScheduleCollectionClassification classification,
        ScheduleCollectionBatchManifest manifest,
        string? failureMessage
    ) =>
        new() {
            ManifestPath = manifestPath,
            TotalModelCount = totalModelCount,
            SuccessCount = 0,
            FailureCount = totalModelCount,
            Results = manifest.Models
                .Select(entry => new ScheduleCollectionResult {
                    Succeeded = false,
                    Classification = classification,
                    Engine = manifest.Engine,
                    Region = entry.Region,
                    ProjectGuid = entry.ProjectGuid,
                    ModelGuid = entry.ModelGuid,
                    FailureMessage = failureMessage
                })
                .ToList()
        };

    private static string BuildArtifactObjectKey(ScheduleCollectionBatchEntry entry, string runId) =>
        $"schedule-collections/{DateTime.UtcNow:yyyy/MM/dd}/{entry.Region.Trim().ToUpperInvariant()}/{entry.ProjectGuid.Trim().ToLowerInvariant()}/{entry.ModelGuid.Trim().ToLowerInvariant()}/{runId}.json";

    private static string BuildArtifactLocalPath(string repoRoot, string engine, string objectKey) =>
        Path.Combine(
            repoRoot,
            ".artifacts",
            "automation",
            "results",
            RevitAutomationParameterCollectionService.ResolveEngineYear(engine).ToString(),
            Path.GetFileName(objectKey)
        );

    private sealed class BatchTracker {
        public ScheduleCollectionOptions Options { get; init; } = null!;
        public string WorkItemId { get; init; } = "";
        public string ArtifactBucketKey { get; init; } = "";
        public string ArtifactObjectKey { get; init; } = "";
        public string ArtifactLocalPath { get; init; } = "";
        public ScheduleCollectionResult? SubmissionFailure { get; init; }
    }
}