using Pe.Shared.RevitAutomation;
using Pe.Shared.ApsAuth;
using Pe.Aps.Auth;
using Pe.Aps;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.RevitVersions;
using System.Net;
using System.Net.Http;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class AutomationScheduleSubmitResult {
    public string ReceiptPath { get; init; } = "";
    public int SubmittedCount { get; init; }
    public int FailureCount { get; init; }
    public AutomationRunReceipt Receipt { get; init; } = new();
}

public sealed class AutomationScheduleSubmissionService {
    private readonly AutomationManifestService _manifestService = new();
    private readonly AutomationProcessingRouteService _routeService = new();
    private readonly AutomationRunOrchestrator _runOrchestrator = new();

    public async Task<AutomationScheduleSubmitResult> RunAsync(
        string manifestPath,
        string? receiptPath,
        bool refresh,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var fullManifestPath = AutomationManifestService.ResolvePath(repoRoot, manifestPath);
        var validation = await this._manifestService.ValidateAsync(
                repoRoot,
                fullManifestPath,
                refresh,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
        if (!validation.IsValid) {
            var messages = validation.Entries
                .Where(entry => !entry.IsValid)
                .Select(entry => $"{entry.Project} :: {entry.ModelPath} :: {entry.FailureMessage}")
                .ToArray();
            throw new InvalidOperationException(
                "Manifest validation failed:" + Environment.NewLine + string.Join(Environment.NewLine, messages));
        }

        var manifest = this._manifestService.Load(repoRoot, fullManifestPath);
        var settings = RevitAutomationSettings.Load(RevitAutomationApsCredentials.GetConfiguredWebClientId());
        var aps = RevitAutomationApsCredentials.CreateAps();
        var createAutomationClient = aps.Automation;
        var userTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext())
        );
        var dataManagementTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForParameterService())
        );
        var artifactTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForAutomationArtifactStorage())
        );

        log?.Invoke("Auth: acquiring management token");
        _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        log?.Invoke("Auth: acquiring delegated user token");
        _ = userTokenLease.GetTokenResult();
        log?.Invoke("Auth: acquiring data-management token");
        _ = dataManagementTokenLease.GetTokenResult();
        log?.Invoke("Auth: acquiring artifact token");
        _ = artifactTokenLease.GetTokenResult();

        var bucketKey = settings.BuildArtifactBucketKey();
        await this._runOrchestrator.EnsureArtifactBucketAsync(
                bucketKey,
                artifactTokenLease.GetAccessToken(),
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        var preparedEntries = manifest.Models
            .Zip(validation.Entries, (manifestEntry, validationEntry) =>
                BuildPreparedEntry(manifestEntry, validationEntry, this._routeService))
            .ToList();

        await this._runOrchestrator.EnsureShellsReadyAsync(
                repoRoot,
                settings,
                preparedEntries.Select(entry => entry.Route.ExecutionRevitYear),
                createAutomationClient,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        var receiptEntries = new List<AutomationRunReceiptEntry>();
        foreach (var preparedEntry in preparedEntries) {
            var manifestEntry = preparedEntry.ManifestEntry;
            var resolved = preparedEntry.ResolvedModel;
            var route = preparedEntry.Route;
            var spec = RevitVersionCatalog.RequireByYear(route.ExecutionRevitYear);
            var shellIds = RevitAutomationShellDefinitions.ForYear(settings, spec.Year);
            var runId = Guid.NewGuid().ToString("D");
            var objectKey = AutomationRunOrchestrator.BuildArtifactObjectKey(
                AutomationJobType.ScheduleCollection,
                resolved.Region,
                resolved.ProjectGuid,
                resolved.ModelGuid,
                runId
            );
            var artifactPath = AutomationDevRunHelpers.BuildArtifactLocalPath(repoRoot, spec.Year, objectKey);
            var request = (manifest.Request ?? ScheduleCollectionBatchRequest.FromContract(
                    ScheduleCollectionDefaults.CreateDefaultRequest()))
                .ToContract();
            var artifactToken = artifactTokenLease.GetAccessToken();
            var expectedTitle = resolved.ModelTitle;
            var input = new AutomationJobInput {
                JobType = AutomationJobType.ScheduleCollection,
                SourceKind = route.ProcessingMode == AutomationProcessingMode.DirectCloud
                    ? AutomationDocumentSourceKind.CloudModel
                    : AutomationDocumentSourceKind.LocalFile,
                Engine = spec.DesignAutomationEngine,
                Region = resolved.Region,
                ProjectGuid = resolved.ProjectGuid,
                ModelGuid = resolved.ModelGuid,
                LocalModelPath = route.ProcessingMode == AutomationProcessingMode.DirectCloud
                    ? null
                    : RevitAutomationShellDefinitions.InputModelLocalName,
                RunId = runId,
                ExpectedTitle = expectedTitle,
                ScheduleCollection = request
            };

            var submissionRequest = new AutomationRunSubmissionRequest(
                repoRoot,
                bucketKey,
                artifactToken,
                userTokenLease.GetAccessToken(),
                createAutomationClient,
                aps.DataManagement(),
                shellIds.QualifiedActivityAlias,
                manifest.TimeoutSeconds,
                manifest.Debug,
                resolved,
                route,
                input,
                objectKey,
                $"Automation: submitting schedule workitem for {resolved.ModelPath} ({spec.Year}, {route.ProcessingMode})"
            );

            try {
                var submissionResult = await this._runOrchestrator.SubmitAsync(
                        submissionRequest,
                        log,
                        cancellationToken
                    )
                    .ConfigureAwait(false);

                if (submissionResult.Submission == null) {
                    receiptEntries.Add(new AutomationRunReceiptEntry {
                        Project = manifestEntry.Project,
                        ModelPath = manifestEntry.ModelPath,
                        RevitYear = spec.Year,
                        ProcessingMode = route.ProcessingMode,
                        SourceRevitYear = route.SourceRevitYear,
                        ExecutionRevitYear = route.ExecutionRevitYear,
                        YearResolutionSource = route.YearResolutionSource,
                        StagedInputKind = submissionResult.StagedInputKind,
                        Region = resolved.Region,
                        ProjectGuid = resolved.ProjectGuid,
                        ModelGuid = resolved.ModelGuid,
                        Status = "submission-failed",
                        ArtifactBucketKey = bucketKey,
                        ArtifactObjectKey = objectKey,
                        ArtifactLocalPath = artifactPath,
                        FailureMessage = submissionResult.FailureMessage,
                        FallbackReason = submissionResult.FallbackReason
                    });
                    continue;
                }

                var submission = submissionResult.Submission;
                receiptEntries.Add(new AutomationRunReceiptEntry {
                    Project = manifestEntry.Project,
                    ModelPath = manifestEntry.ModelPath,
                    WorkItemId = submission.Id,
                    RevitYear = spec.Year,
                    ProcessingMode = route.ProcessingMode,
                    SourceRevitYear = route.SourceRevitYear,
                    ExecutionRevitYear = route.ExecutionRevitYear,
                    YearResolutionSource = route.YearResolutionSource,
                    StagedInputKind = submissionResult.StagedInputKind,
                    Region = resolved.Region,
                    ProjectGuid = resolved.ProjectGuid,
                    ModelGuid = resolved.ModelGuid,
                    Status = string.IsNullOrWhiteSpace(submission.WorkItemStatus.Status) ? "submitted" : submission.WorkItemStatus.Status,
                    ReportUrl = submission.WorkItemStatus.ReportUrl,
                    ArtifactBucketKey = bucketKey,
                    ArtifactObjectKey = objectKey,
                    ArtifactLocalPath = artifactPath,
                    FallbackReason = submissionResult.FallbackReason
                });
            } catch (Exception ex) {
                receiptEntries.Add(new AutomationRunReceiptEntry {
                    Project = manifestEntry.Project,
                    ModelPath = manifestEntry.ModelPath,
                    RevitYear = spec.Year,
                    ProcessingMode = route.ProcessingMode,
                    SourceRevitYear = route.SourceRevitYear,
                    ExecutionRevitYear = route.ExecutionRevitYear,
                    YearResolutionSource = route.YearResolutionSource,
                    StagedInputKind = route.ProcessingMode == AutomationProcessingMode.DirectCloud
                        ? null
                        : AutomationStagedInputKind.Rvt,
                    Region = resolved.Region,
                    ProjectGuid = resolved.ProjectGuid,
                    ModelGuid = resolved.ModelGuid,
                    Status = "submission-failed",
                    ArtifactBucketKey = bucketKey,
                    ArtifactObjectKey = objectKey,
                    ArtifactLocalPath = artifactPath,
                    FailureMessage = ex.Message,
                    FallbackReason = route.FallbackReason
                });
            }
        }

        var paths = new AutomationStatePaths(repoRoot);
        Directory.CreateDirectory(paths.ReceiptsRoot);
        var resolvedReceiptPath = string.IsNullOrWhiteSpace(receiptPath)
            ? paths.GetReceiptPath(fullManifestPath)
            : AutomationManifestService.ResolvePath(repoRoot, receiptPath);
        var receipt = new AutomationRunReceipt {
            SubmittedAtUtc = DateTime.UtcNow.ToString("O"),
            ManifestPath = fullManifestPath,
            Hub = manifest.Hub,
            Entries = receiptEntries
        };
        File.WriteAllText(resolvedReceiptPath, Newtonsoft.Json.JsonConvert.SerializeObject(receipt, Newtonsoft.Json.Formatting.Indented));

        return new AutomationScheduleSubmitResult {
            ReceiptPath = resolvedReceiptPath,
            SubmittedCount = receiptEntries.Count(entry => !string.IsNullOrWhiteSpace(entry.WorkItemId)),
            FailureCount = receiptEntries.Count(entry => string.IsNullOrWhiteSpace(entry.WorkItemId)),
            Receipt = receipt
        };
    }

    private static PreparedAutomationScheduleEntry BuildPreparedEntry(
        ScheduleAuditManifestEntry manifestEntry,
        AutomationManifestValidationEntry validationEntry,
        AutomationProcessingRouteService routeService
    ) {
        if (!validationEntry.IsValid || validationEntry.ResolvedModel == null) {
            throw new InvalidOperationException(
                $"Manifest validation entry for '{manifestEntry.Project} :: {manifestEntry.ModelPath}' was unexpectedly invalid during submission.");
        }

        return new PreparedAutomationScheduleEntry(
            manifestEntry,
            validationEntry.ResolvedModel,
            routeService.ResolveRoute(manifestEntry, validationEntry.ResolvedModel)
        );
    }
}

internal sealed record PreparedAutomationScheduleEntry(
    ScheduleAuditManifestEntry ManifestEntry,
    ModelResolutionResult ResolvedModel,
    ResolvedAutomationProcessingRoute Route
);

public sealed class AutomationReceiptInspectionService {
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<(string ReceiptPath, AutomationRunReceipt Receipt)> InspectReceiptAsync(
        string receiptSelector,
        bool refresh,
        bool downloadArtifacts,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var receiptPath = ResolveReceiptPath(repoRoot, receiptSelector);
        var receipt = AutomationRunReceipt.LoadFromFile(receiptPath);
        var settings = RevitAutomationSettings.Load(RevitAutomationApsCredentials.GetConfiguredWebClientId());
        var aps = RevitAutomationApsCredentials.CreateAps();
        var designAutomation = aps.DesignAutomation();
        var artifactTokenLease = new RefreshingApsTokenLease(
            () => aps.GetTokenResult(ApsTokenRequest.ForAutomationArtifactStorage())
        );

        _ = aps.GetTokenResult(ApsTokenRequest.ForAutomationManagement());
        if (downloadArtifacts)
            _ = artifactTokenLease.GetTokenResult();

        var workItemIds = receipt.Entries
            .Where(entry => !string.IsNullOrWhiteSpace(entry.WorkItemId))
            .Select(entry => entry.WorkItemId!)
            .ToArray();
        var statuses = new Dictionary<string, AutomationWorkItemStatus>(StringComparer.Ordinal);
        if (workItemIds.Length > 0) {
            foreach (var status in await designAutomation.GetStatusesWithFallbackAsync(workItemIds, log, cancellationToken)
                         .ConfigureAwait(false)) {
                if (!string.IsNullOrWhiteSpace(status.Id))
                    statuses[status.Id] = status;
            }
        }

        foreach (var entry in receipt.Entries) {
            if (string.IsNullOrWhiteSpace(entry.WorkItemId))
                continue;

            if (!statuses.TryGetValue(entry.WorkItemId, out var status)) {
                status = await designAutomation.GetStatusAsync(entry.WorkItemId, cancellationToken)
                    .ConfigureAwait(false);
            }

            entry.Status = status.Status;
            entry.ReportUrl = status.ReportUrl;

            if (string.IsNullOrWhiteSpace(status.ReportUrl))
                continue;

            var reportContent = await designAutomation.GetReportContentAsync(status.ReportUrl, cancellationToken)
                .ConfigureAwait(false);
            var parsed = this._reportParser.Parse(reportContent);
            entry.DocumentTitle = parsed.DocumentTitle;
            entry.RawReportExcerpt = parsed.RawExcerpt;
            if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase))
                entry.FailureMessage = parsed.FailureMessage;

            if (!downloadArtifacts ||
                !string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(entry.ArtifactBucketKey) ||
                string.IsNullOrWhiteSpace(entry.ArtifactObjectKey) ||
                string.IsNullOrWhiteSpace(entry.ArtifactLocalPath))
                continue;

            log?.Invoke($"Artifacts: downloading {entry.ArtifactBucketKey}/{entry.ArtifactObjectKey}");
            await new ObjectStorageApiClient(artifactTokenLease.GetAccessToken())
                .DownloadObjectAsync(entry.ArtifactBucketKey, entry.ArtifactObjectKey, entry.ArtifactLocalPath, cancellationToken)
                .ConfigureAwait(false);
            await AutomationDevRunHelpers.ValidateJsonArtifactAsync<ScheduleCollectionArtifact>(
                    entry.ArtifactLocalPath,
                    "Downloaded schedule collection artifact was unreadable JSON.",
                    cancellationToken
                )
                .ConfigureAwait(false);
        }

        File.WriteAllText(receiptPath, Newtonsoft.Json.JsonConvert.SerializeObject(receipt, Newtonsoft.Json.Formatting.Indented));
        return (receiptPath, receipt);
    }

    public async Task<AutomationWorkItemInspectResult> InspectWorkItemAsync(
        string workItemId,
        bool includeReport,
        CancellationToken cancellationToken
    ) {
        var service = new RevitAutomationWorkItemInspectorService();
        return await service.RunAsync(
                new AutomationWorkItemInspectOptions(workItemId, includeReport, false, false),
                cancellationToken
            )
            .ConfigureAwait(false);
    }

    private static string ResolveReceiptPath(string repoRoot, string selector) {
        if (!string.Equals(selector, "latest", StringComparison.OrdinalIgnoreCase))
            return AutomationManifestService.ResolvePath(repoRoot, selector);

        var paths = new AutomationStatePaths(repoRoot);
        if (!Directory.Exists(paths.ReceiptsRoot))
            throw new InvalidOperationException("No receipt files have been written yet.");

        var latest = Directory.EnumerateFiles(paths.ReceiptsRoot, "*.json", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
        return latest ?? throw new InvalidOperationException("No receipt files have been written yet.");
    }
}

