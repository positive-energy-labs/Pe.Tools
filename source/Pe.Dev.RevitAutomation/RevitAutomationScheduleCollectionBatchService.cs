using Pe.Shared.RevitAutomation;
using Pe.Shared.ApsAuth;
using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitData.Schedules;
using System.IO;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationScheduleCollectionBatchService {
    private readonly AutomationShellDeploymentService _shellDeployment = new();
    private readonly DesignAutomationBatchWorkItemRunner _batchRunner = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();
    private readonly AutomationArtifactFinalizer _artifactFinalizer = new();

    public async Task<ScheduleCollectionBatchResult> RunAsync(
        string manifestPath,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var manifest = ScheduleCollectionBatchManifest.LoadFromFile(manifestPath);
        var credentialSource = new ApsCredentialSource();
        var settings = RevitAutomationSettings.Load(credentialSource.GetConfiguredWebClientId());
        var resolvedEntries = ResolveEntries(manifest, settings);
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
            return BuildPreflightFailure(manifestPath, resolvedEntries, ScheduleCollectionClassification.ManagementTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring delegated user token");
            _ = userTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, resolvedEntries, ScheduleCollectionClassification.UserTokenFailed, ex.Message);
        }

        try {
            log?.Invoke("Auth: acquiring artifact token");
            _ = artifactTokenLease.GetTokenResult();
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, resolvedEntries, ScheduleCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        var bucketKey = settings.BuildArtifactBucketKey();

        try {
            log?.Invoke($"Artifacts: ensuring OSS bucket {bucketKey}");
            await new ObjectStorageApiClient(artifactTokenLease.GetAccessToken())
                .EnsureTransientBucketAsync(bucketKey, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildPreflightFailure(manifestPath, resolvedEntries, ScheduleCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        var results = new List<ScheduleCollectionResult>();
        foreach (var yearGroup in resolvedEntries.GroupBy(entry => entry.Spec.Year).OrderBy(group => group.Key)) {
            var groupEntries = yearGroup.ToArray();
            var spec = groupEntries[0].Spec;
            var shellIds = groupEntries[0].ShellIds;

            try {
                await this._shellDeployment.EnsureReadyAsync(
                        repoRoot,
                        shellIds,
                        spec,
                        createAutomationClient,
                        log,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
            } catch (HttpRequestException ex) when (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
                results.AddRange(BuildGroupFailure(groupEntries, ScheduleCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message));
                continue;
            } catch (Exception ex) {
                results.AddRange(BuildGroupFailure(groupEntries, ScheduleCollectionClassification.WorkItemSubmissionFailed, ex.Message));
                continue;
            }

            await this.RunGroupAsync(
                    groupEntries,
                    manifest,
                    repoRoot,
                    bucketKey,
                    createAutomationClient,
                    artifactTokenLease,
                    userTokenLease,
                    log,
                    results,
                    cancellationToken
                )
                .ConfigureAwait(false);
        }

        return new ScheduleCollectionBatchResult {
            ManifestPath = manifestPath,
            TotalModelCount = resolvedEntries.Count,
            SuccessCount = results.Count(result => result.Succeeded),
            FailureCount = results.Count(result => !result.Succeeded),
            Results = results
        };
    }

    private async Task RunGroupAsync(
        IReadOnlyList<ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions>> groupEntries,
        ScheduleCollectionBatchManifest manifest,
        string repoRoot,
        string bucketKey,
        Func<AutomationApiClient> createAutomationClient,
        RefreshingApsTokenLease artifactTokenLease,
        RefreshingApsTokenLease userTokenLease,
        Action<string>? log,
        List<ScheduleCollectionResult> results,
        CancellationToken cancellationToken
    ) =>
        await this._batchRunner.RunGroupAsync(
                groupEntries,
                manifest.MaxConcurrency,
                manifest.TimeoutSeconds,
                resolved => this.SubmitAsync(
                    resolved,
                    manifest,
                    repoRoot,
                    bucketKey,
                    createAutomationClient,
                    artifactTokenLease,
                    userTokenLease,
                    log,
                    cancellationToken
                ),
                (tracker, status) => this.FinalizeSafelyAsync(
                    tracker,
                    status,
                    createAutomationClient,
                    artifactTokenLease,
                    log,
                    cancellationToken
                ),
                BuildTimedOutResult,
                createAutomationClient,
                log,
                results,
                cancellationToken
            )
            .ConfigureAwait(false);

    private async Task<DesignAutomationBatchSubmission<BatchTracker, ScheduleCollectionResult>> SubmitAsync(
        ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions> resolved,
        ScheduleCollectionBatchManifest manifest,
        string repoRoot,
        string bucketKey,
        Func<AutomationApiClient> createAutomationClient,
        RefreshingApsTokenLease artifactTokenLease,
        RefreshingApsTokenLease userTokenLease,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var options = resolved.Options;
        var runId = Guid.NewGuid().ToString("D");
        var objectKey = BuildArtifactObjectKey(resolved.Entry, runId);
        var artifactPath = AutomationDevRunHelpers.BuildArtifactLocalPath(repoRoot, resolved.Spec.Year, objectKey);
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

        try {
            var artifactToken = artifactTokenLease.GetAccessToken();
            var submittedAtUtc = DateTime.UtcNow;
            var submission = await this._workItemRunner.SubmitAsync(
                    createAutomationClient,
                    new AutomationWorkItemSpec {
                        ActivityId = resolved.ShellIds.QualifiedActivityAlias,
                        LimitProcessingTimeSec = manifest.TimeoutSeconds,
                        Debug = manifest.Debug,
                        Arguments = AutomationRunOrchestrator.BuildWorkItemArguments(
                            input,
                            bucketKey,
                            objectKey,
                            artifactToken,
                            userTokenLease.GetAccessToken()
                        )
                    },
                    $"Automation: submitting batch schedule workitem for {resolved.Entry.ModelGuid} ({resolved.Spec.Year})",
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);

            return DesignAutomationBatchSubmission<BatchTracker, ScheduleCollectionResult>.Submitted(new BatchTracker {
                Options = options,
                WorkItemId = submission.Id,
                SubmittedAtUtc = submittedAtUtc,
                DeadlineUtc = DesignAutomationRunHelpers.ComputeDeadlineUtc(submittedAtUtc, manifest.TimeoutSeconds),
                ArtifactBucketKey = bucketKey,
                ArtifactObjectKey = objectKey,
                ArtifactLocalPath = artifactPath
            });
        } catch (HttpRequestException ex) when (AutomationDevRunHelpers.HasStatusCode(ex, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden)) {
            return DesignAutomationBatchSubmission<BatchTracker, ScheduleCollectionResult>.Failed(new ScheduleCollectionResult {
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
            });
        } catch (Exception ex) {
            return DesignAutomationBatchSubmission<BatchTracker, ScheduleCollectionResult>.Failed(new ScheduleCollectionResult {
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
            });
        }
    }

    private async Task<ScheduleCollectionResult> FinalizeSafelyAsync(
        BatchTracker tracker,
        AutomationWorkItemStatus status,
        Func<AutomationApiClient> createAutomationClient,
        RefreshingApsTokenLease artifactTokenLease,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        try {
            return await this.FinalizeAsync(
                    tracker,
                    status,
                    createAutomationClient,
                    artifactTokenLease,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (Exception ex) {
            log?.Invoke($"Automation: finalization failed for workitem {tracker.WorkItemId}. {ex.Message}");
            return BuildFinalizeFailureResult(tracker, ex.Message);
        }
    }

    private async Task<ScheduleCollectionResult> FinalizeAsync(
        BatchTracker tracker,
        AutomationWorkItemStatus status,
        Func<AutomationApiClient> createAutomationClient,
        RefreshingApsTokenLease artifactTokenLease,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var finalized = await this._artifactFinalizer.FinalizeAsync<ScheduleCollectionArtifact>(
                tracker.WorkItemId,
                status,
                createAutomationClient,
                artifactTokenLease,
                tracker.ArtifactBucketKey,
                tracker.ArtifactObjectKey,
                tracker.ArtifactLocalPath,
                "Downloaded schedule collection artifact was unreadable JSON.",
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        return finalized.Status switch {
            AutomationArtifactFinalizationStatus.ReportFetchFailed =>
                BuildFinalizeFailureResult(tracker, finalized.FailureMessage),
            AutomationArtifactFinalizationStatus.ReportedFailure =>
                BuildFailureResult(tracker, finalized.ParsedReport ?? new ParsedAutomationJobReport(), ScheduleCollectionClassification.CollectionFailed),
            AutomationArtifactFinalizationStatus.ArtifactDownloadFailed =>
                BuildArtifactFailureResult(tracker, finalized.ParsedReport, ScheduleCollectionClassification.ArtifactDownloadFailed, finalized.FailureMessage),
            AutomationArtifactFinalizationStatus.ArtifactValidationFailed =>
                BuildArtifactFailureResult(tracker, finalized.ParsedReport, ScheduleCollectionClassification.ArtifactValidationFailed, finalized.FailureMessage),
            AutomationArtifactFinalizationStatus.Success =>
                BuildSuccessResult(tracker, finalized),
            _ => BuildFinalizeFailureResult(tracker, "Unexpected automation artifact finalization status.")
        };
    }

    private static List<ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions>> ResolveEntries(
        ScheduleCollectionBatchManifest manifest,
        RevitAutomationSettings settings
    ) =>
        manifest.Models.Select(entry => {
            var spec = entry.ResolveSpec(manifest.Engine);
            return new ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions>(
                entry,
                entry.ToOptions(manifest, spec.DesignAutomationEngine),
                spec,
                RevitAutomationShellDefinitions.ForYear(settings, spec.Year)
            );
        }).ToList();

    private static IReadOnlyList<ScheduleCollectionResult> BuildGroupFailure(
        IEnumerable<ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions>> entries,
        ScheduleCollectionClassification classification,
        string? failureMessage
    ) =>
        entries.Select(resolved => new ScheduleCollectionResult {
            Succeeded = false,
            Classification = classification,
            Engine = resolved.Options.Engine,
            Region = resolved.Options.Region,
            ProjectGuid = resolved.Options.ProjectGuid,
            ModelGuid = resolved.Options.ModelGuid,
            FailureMessage = failureMessage
        }).ToArray();

    private static ScheduleCollectionResult BuildArtifactFailureResult(
        BatchTracker tracker,
        ParsedAutomationJobReport? parsedReport,
        ScheduleCollectionClassification classification,
        string? failureMessage
    ) =>
        new() {
            Succeeded = false,
            Classification = classification,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            DocumentTitle = parsedReport?.DocumentTitle,
            FailureMessage = failureMessage,
            RawReportExcerpt = parsedReport?.RawExcerpt,
            ArtifactBucketKey = tracker.ArtifactBucketKey,
            ArtifactObjectKey = tracker.ArtifactObjectKey,
            ArtifactLocalPath = tracker.ArtifactLocalPath
        };

    private static ScheduleCollectionResult BuildSuccessResult(
        BatchTracker tracker,
        AutomationArtifactFinalization<ScheduleCollectionArtifact> finalized
    ) {
        if (finalized.Artifact == null)
            return BuildFinalizeFailureResult(tracker, "Automation artifact finalization did not return an artifact.");

        return new ScheduleCollectionResult {
            Succeeded = true,
            Classification = ScheduleCollectionClassification.Success,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            DocumentTitle = finalized.ParsedReport?.DocumentTitle ?? finalized.Artifact.DocumentTitle,
            RawReportExcerpt = finalized.ParsedReport?.RawExcerpt,
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
            nameof(ProbeAccessClassification.ExpectedTitleMismatch) or "ExpectedTitleMismatch" =>
                ScheduleCollectionClassification.ExpectedTitleMismatch,
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

    private static ScheduleCollectionResult BuildFinalizeFailureResult(BatchTracker tracker, string? failureMessage) =>
        new() {
            Succeeded = false,
            Classification = ScheduleCollectionClassification.CollectionFailed,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            FailureMessage = failureMessage,
            ArtifactBucketKey = tracker.ArtifactBucketKey,
            ArtifactObjectKey = tracker.ArtifactObjectKey,
            ArtifactLocalPath = tracker.ArtifactLocalPath
        };

    private static ScheduleCollectionBatchResult BuildPreflightFailure(
        string manifestPath,
        IReadOnlyList<ResolvedAutomationBatchEntry<ScheduleCollectionBatchEntry, ScheduleCollectionOptions>> entries,
        ScheduleCollectionClassification classification,
        string? failureMessage
    ) =>
        new() {
            ManifestPath = manifestPath,
            TotalModelCount = entries.Count,
            SuccessCount = 0,
            FailureCount = entries.Count,
            Results = entries.Select(resolved => new ScheduleCollectionResult {
                Succeeded = false,
                Classification = classification,
                Engine = resolved.Options.Engine,
                Region = resolved.Options.Region,
                ProjectGuid = resolved.Options.ProjectGuid,
                ModelGuid = resolved.Options.ModelGuid,
                FailureMessage = failureMessage
            }).ToList()
        };

    private static string BuildArtifactObjectKey(ScheduleCollectionBatchEntry entry, string runId) =>
        AutomationRunOrchestrator.BuildArtifactObjectKey(
            AutomationJobType.ScheduleCollection,
            entry.Region,
            entry.ProjectGuid,
            entry.ModelGuid,
            runId
        );

    private static ScheduleCollectionResult BuildTimedOutResult(BatchTracker tracker, int timeoutSeconds) =>
        new() {
            Succeeded = false,
            Classification = ScheduleCollectionClassification.TimedOut,
            WorkItemId = tracker.WorkItemId,
            Engine = tracker.Options.Engine,
            Region = tracker.Options.Region,
            ProjectGuid = tracker.Options.ProjectGuid,
            ModelGuid = tracker.Options.ModelGuid,
            ArtifactBucketKey = tracker.ArtifactBucketKey,
            ArtifactObjectKey = tracker.ArtifactObjectKey,
            ArtifactLocalPath = tracker.ArtifactLocalPath,
            FailureMessage = $"Automation workitem '{tracker.WorkItemId}' timed out after {timeoutSeconds} seconds."
        };

    private sealed class BatchTracker : IDesignAutomationBatchWorkItemTracker {
        public ScheduleCollectionOptions Options { get; init; } = null!;
        public string WorkItemId { get; init; } = "";
        public DateTime SubmittedAtUtc { get; init; }
        public DateTime DeadlineUtc { get; init; }
        public string ArtifactBucketKey { get; init; } = "";
        public string ArtifactObjectKey { get; init; } = "";
        public string ArtifactLocalPath { get; init; } = "";
    }
}

