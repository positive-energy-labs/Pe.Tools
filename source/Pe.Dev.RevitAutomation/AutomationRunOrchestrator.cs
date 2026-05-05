using Pe.Shared.RevitAutomation;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitVersions;
using System.Net;
using System.Net.Http;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationRunOrchestrator {
    private readonly AutomationShellDeploymentService _shellDeployment = new();
    private readonly DesignAutomationWorkItemRunner _workItemRunner = new();
    private readonly AutomationModelStagingService _stagingService = new();

    public async Task EnsureArtifactBucketAsync(
        string bucketKey,
        string artifactAccessToken,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        log?.Invoke($"Artifacts: ensuring OSS bucket {bucketKey}");
        await new ObjectStorageApiClient(artifactAccessToken)
            .EnsureTransientBucketAsync(bucketKey, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task EnsureShellsReadyAsync(
        string repoRoot,
        RevitAutomationSettings settings,
        IEnumerable<int> executionYears,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        foreach (var executionYear in executionYears.Distinct().OrderBy(year => year)) {
            var spec = RevitVersionCatalog.RequireByYear(executionYear);
            var shellIds = RevitAutomationShellDefinitions.ForYear(settings, spec.Year);
            await this._shellDeployment.EnsureReadyAsync(
                    repoRoot,
                    shellIds,
                    spec,
                    createAutomationClient,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        }
    }

    public async Task<AutomationRunSubmissionResult> SubmitAsync(
        AutomationRunSubmissionRequest request,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var stagedInputKind = request.Route.ProcessingMode == AutomationProcessingMode.DirectCloud
            ? (AutomationStagedInputKind?)null
            : AutomationStagedInputKind.Rvt;
        var fallbackReason = request.Route.FallbackReason;
        var arguments = BuildWorkItemArguments(
            request.Input,
            request.BucketKey,
            request.ArtifactObjectKey,
            request.ArtifactAccessToken,
            request.UserAccessToken
        );

        if (request.Route.ProcessingMode == AutomationProcessingMode.TransientLocalUpgrade) {
            var stagingResult = await this._stagingService.StageLocalModelAsync(
                    request.RepoRoot,
                    request.ResolvedModel,
                    request.BucketKey,
                    request.Input.RunId,
                    request.ArtifactAccessToken,
                    request.DataManagementClient,
                    new ObjectStorageApiClient(request.ArtifactAccessToken),
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);

            stagedInputKind = stagingResult.StagedInputKind;
            if (stagingResult.StagedInputKind != AutomationStagedInputKind.Rvt ||
                stagingResult.InputArgument == null) {
                fallbackReason = BuildTransientLocalUpgradeFailureReason(request.Route.SourceRevitYear);
                return AutomationRunSubmissionResult.Failed(
                    stagedInputKind,
                    stagingResult.FailureMessage,
                    fallbackReason
                );
            }

            arguments["inputModel"] = stagingResult.InputArgument
                .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        }

        var submission = await this._workItemRunner.SubmitAsync(
                request.CreateAutomationClient,
                new AutomationWorkItemSpec {
                    ActivityId = request.ActivityId,
                    LimitProcessingTimeSec = request.TimeoutSeconds,
                    Debug = request.Debug,
                    Arguments = arguments
                },
                request.SubmissionLogMessage,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        return AutomationRunSubmissionResult.Submitted(submission, stagedInputKind, fallbackReason);
    }

    public static Dictionary<string, object> BuildWorkItemArguments(
        AutomationJobInput input,
        string bucketKey,
        string objectKey,
        string artifactAccessToken,
        string userAccessToken,
        IReadOnlyDictionary<string, object>? inputModelArgument = null
    ) {
        var arguments = new Dictionary<string, object>(StringComparer.Ordinal) {
            ["inputParams"] = new Dictionary<string, object>(StringComparer.Ordinal) {
                ["url"] = DesignAutomationWorkItemArguments.BuildJsonDataUrl(input.ToJson())
            },
            ["resultJson"] = DesignAutomationWorkItemArguments.BuildObjectPutArgument(
                bucketKey,
                objectKey,
                artifactAccessToken
            ),
            ["adsk3LeggedToken"] = userAccessToken
        };

        if (inputModelArgument != null) {
            arguments["inputModel"] = inputModelArgument
                .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        }

        return arguments;
    }

    public static string BuildArtifactObjectKey(
        AutomationJobType jobType,
        string region,
        string projectGuid,
        string modelGuid,
        string runId
    ) {
        var prefix = jobType switch {
            AutomationJobType.ParameterCollection => "parameter-collections",
            AutomationJobType.ScheduleCollection => "schedule-collections",
            _ => throw new ArgumentOutOfRangeException(nameof(jobType), jobType, "Unsupported automation job type.")
        };
        return $"{prefix}/{DateTime.UtcNow:yyyy/MM/dd}/{region.Trim().ToUpperInvariant()}/" +
               $"{projectGuid.Trim().ToLowerInvariant()}/{modelGuid.Trim().ToLowerInvariant()}/{runId}.json";
    }

    public static bool IsSubmissionUnauthorized(HttpRequestException exception) =>
        AutomationDevRunHelpers.HasStatusCode(exception, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);

    private static string BuildTransientLocalUpgradeFailureReason(int? sourceRevitYear) =>
        $"Source model year {sourceRevitYear} requires transient local upgrade, but the downloaded source was not a single RVT file supported by this MVP.";
}

internal sealed record AutomationRunSubmissionRequest(
    string RepoRoot,
    string BucketKey,
    string ArtifactAccessToken,
    string UserAccessToken,
    Func<AutomationApiClient> CreateAutomationClient,
    DataManagementApiClient DataManagementClient,
    string ActivityId,
    int TimeoutSeconds,
    bool Debug,
    ModelResolutionResult ResolvedModel,
    ResolvedAutomationProcessingRoute Route,
    AutomationJobInput Input,
    string ArtifactObjectKey,
    string SubmissionLogMessage
);

internal sealed class AutomationRunSubmissionResult {
    private AutomationRunSubmissionResult() { }

    public SubmittedDesignAutomationWorkItem? Submission { get; private init; }
    public AutomationStagedInputKind? StagedInputKind { get; private init; }
    public string? FailureMessage { get; private init; }
    public string? FallbackReason { get; private init; }

    public static AutomationRunSubmissionResult Submitted(
        SubmittedDesignAutomationWorkItem submission,
        AutomationStagedInputKind? stagedInputKind,
        string? fallbackReason
    ) =>
        new() {
            Submission = submission,
            StagedInputKind = stagedInputKind,
            FallbackReason = fallbackReason
        };

    public static AutomationRunSubmissionResult Failed(
        AutomationStagedInputKind? stagedInputKind,
        string? failureMessage,
        string? fallbackReason
    ) =>
        new() {
            StagedInputKind = stagedInputKind,
            FailureMessage = failureMessage,
            FallbackReason = fallbackReason
        };
}
