using Newtonsoft.Json;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.Aps.Models;
using Pe.Shared.HostContracts.RevitData;
using System.IO;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationParameterCollectionService {
    private readonly RevitAutomationWorkerBundleBuilder _bundleBuilder = new();
    private readonly AutomationJobReportParser _reportParser = new();

    public async Task<ParameterCollectionResult> RunAsync(
        ParameterCollectionOptions options,
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
            return BuildFailure(options, ParameterCollectionClassification.ManagementTokenFailed, ex.Message);
        }

        ApsTokenResult userToken;
        try {
            log?.Invoke("Auth: acquiring delegated user token");
            userToken = aps.GetTokenResult(ApsTokenRequest.ForAutomationUserContext());
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.UserTokenFailed, ex.Message);
        }

        ApsTokenResult artifactToken;
        try {
            log?.Invoke("Auth: acquiring artifact token");
            artifactToken = aps.GetTokenResult(new ApsTokenRequest {
                FlowKind = ApsAuthFlowKind.TwoLegged,
                ExplicitScopes = ["bucket:create", "bucket:read", "data:read", "data:write"]
            });
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.ArtifactTokenFailed, ex.Message);
        }

        WorkerBundleArtifact bundle;
        try {
            bundle = await this._bundleBuilder.BuildAsync(repoRoot, options.Engine, log, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, ex.Message);
        }

        var automationClient = aps.Automation();
        try {
            await EnsureShellReadyAsync(
                    automationClient,
                    settings,
                    options.Engine,
                    bundle.PackageContents,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        } catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, ex.Message);
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

        AutomationWorkItemStatus submission;
        try {
            log?.Invoke("Automation: submitting parameter collection workitem");
            submission = await automationClient.SubmitWorkItemAsync(
                    new AutomationWorkItemSpec {
                        ActivityId = $"{settings.Namespace}.{settings.ActivityId}+{settings.AliasId}",
                        LimitProcessingTimeSec = options.TimeoutSeconds,
                        Debug = options.Debug,
                        Arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
                            ["inputParams"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                                ["url"] = BuildJsonDataUrl(input.ToJson())
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
        } catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionUnauthorized, ex.Message);
        } catch (Exception ex) {
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, ex.Message);
        }

        if (string.IsNullOrWhiteSpace(submission.Id))
            return BuildFailure(options, ParameterCollectionClassification.WorkItemSubmissionFailed, "Automation workitem submission did not return an id.");

        log?.Invoke($"Automation: workitem {submission.Id}");
        var deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
        AutomationWorkItemStatus status = submission;
        while (!IsTerminal(status.Status) && DateTime.UtcNow < deadline) {
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            status = await automationClient.GetWorkItemStatusAsync(submission.Id, cancellationToken).ConfigureAwait(false);
        }

        if (!IsTerminal(status.Status)) {
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
                FailureMessage = $"Automation workitem '{submission.Id}' timed out after {options.TimeoutSeconds} seconds."
            };
        }

        var report = await automationClient.GetWorkItemReportAsync(status.ReportUrl, cancellationToken).ConfigureAwait(false);
        var parsedReport = this._reportParser.Parse(report.ReportContent);
        if (!string.Equals(status.Status, "success", StringComparison.OrdinalIgnoreCase)) {
            return BuildReportFailure(options, submission.Id, bucketKey, objectKey, artifactPath, parsedReport);
        }

        try {
            log?.Invoke($"Artifacts: downloading {bucketKey}/{objectKey}");
            await objectStorage.DownloadObjectAsync(bucketKey, objectKey, artifactPath, cancellationToken).ConfigureAwait(false);
            _ = JsonConvert.DeserializeObject<ParameterCollectionArtifact>(await File.ReadAllTextAsync(artifactPath, cancellationToken).ConfigureAwait(false))
                ?? throw new InvalidDataException("Downloaded parameter collection artifact was unreadable JSON.");
        } catch (Exception ex) {
            return new ParameterCollectionResult {
                Succeeded = false,
                Classification = ParameterCollectionClassification.ArtifactDownloadFailed,
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

        return new ParameterCollectionResult {
            Succeeded = true,
            Classification = ParameterCollectionClassification.Success,
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

    internal static async Task EnsureShellReadyAsync(
        Pe.Revit.Global.Services.Aps.Core.AutomationApiClient automationClient,
        RevitAutomationSettings settings,
        string engine,
        byte[] packageContents,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        log?.Invoke("Automation: resolving appbundle");
        await automationClient.CreateOrUpdateAppBundleAsync(
                new AutomationAppBundleSpec {
                    Id = settings.AppBundleId,
                    Package = settings.AppBundleId,
                    Engine = engine,
                    Description = "Pe.Tools Revit automation shell",
                    AliasId = settings.AliasId
                },
                packageContents,
                cancellationToken
            )
            .ConfigureAwait(false);

        log?.Invoke("Automation: resolving activity");
        await automationClient.CreateOrUpdateActivityAsync(
                RevitAutomationShellDefinitions.CreateActivitySpec(settings, engine),
                cancellationToken
            )
            .ConfigureAwait(false);
    }

    internal static string BuildJsonDataUrl(string json) => $"data:application/json,{Uri.EscapeDataString(json)}";

    internal static bool IsTerminal(string? status) =>
        status is not null &&
        (
            status.Equals("success", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("failed", StringComparison.OrdinalIgnoreCase) ||
            status.StartsWith("failed", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("cancelled", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("timeout", StringComparison.OrdinalIgnoreCase)
        );

    internal static int ResolveEngineYear(string engine) {
        if (engine.Contains("2026", StringComparison.Ordinal))
            return 2026;
        if (engine.Contains("2025", StringComparison.Ordinal))
            return 2025;

        throw new InvalidOperationException($"Unsupported Revit automation engine '{engine}'.");
    }

    private static string BuildArtifactObjectKey(ParameterCollectionOptions options, string runId) {
        var region = options.Region.Trim().ToUpperInvariant();
        var projectGuid = options.ProjectGuid.Trim().ToLowerInvariant();
        var modelGuid = options.ModelGuid.Trim().ToLowerInvariant();
        return $"parameter-collections/{DateTime.UtcNow:yyyy/MM/dd}/{region}/{projectGuid}/{modelGuid}/{runId}.json";
    }

    private static string BuildArtifactLocalPath(string repoRoot, string engine, string objectKey) {
        var fileName = Path.GetFileName(objectKey);
        return Path.Combine(
            repoRoot,
            ".artifacts",
            "automation",
            "results",
            ResolveEngineYear(engine).ToString(),
            fileName
        );
    }

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
