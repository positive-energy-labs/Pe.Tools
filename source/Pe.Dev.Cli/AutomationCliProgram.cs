using System.Text.Json;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class AutomationCliProgram {
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private static readonly TimeSpan MinimumProbeLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan ProbeTimeoutBuffer = TimeSpan.FromMinutes(2);

    public static async Task<int> RunAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) =>
        args.Count == 0
            ? WriteAutomationUsageAndReturn()
            : args[0].ToLowerInvariant() switch {
                "collect-parameters" => await RunCollectParametersAsync(args, repoRootOverride, cancellationToken),
                "collect-parameters-batch" => await RunCollectParametersBatchAsync(args, repoRootOverride, cancellationToken),
                "collect-schedules" => await RunCollectSchedulesAsync(args, repoRootOverride, cancellationToken),
                "collect-schedules-batch" => await RunCollectSchedulesBatchAsync(args, repoRootOverride, cancellationToken),
                "discover-models" => await RunDiscoverModelsAsync(args, repoRootOverride, cancellationToken),
                "list-contents" => await RunListContentsAsync(args, cancellationToken),
                "list-hubs" => await RunListHubsAsync(args, cancellationToken),
                "list-projects" => await RunListProjectsAsync(args, cancellationToken),
                "probe-access" => await RunProbeAccessAsync(args, repoRootOverride, cancellationToken),
                "workitem-status" => await RunWorkItemStatusAsync(args, cancellationToken),
                _ => WriteAutomationUsageAndReturn()
            };

    private static async Task<int> RunListHubsAsync(
        IReadOnlyList<string> args,
        CancellationToken cancellationToken
    ) {
        AutomationListHubsCliOptions options;
        try {
            options = AutomationListHubsCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationModelDiscoveryService();
        AutomationHubCatalogResult result;
        try {
            result = await service.ListHubsAsync(
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return 0;
    }

    private static async Task<int> RunListProjectsAsync(
        IReadOnlyList<string> args,
        CancellationToken cancellationToken
    ) {
        AutomationListProjectsCliOptions options;
        try {
            options = AutomationListProjectsCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationModelDiscoveryService();
        AutomationProjectCatalogResult result;
        try {
            result = await service.ListProjectsAsync(
                options.ToOptions(),
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return 0;
    }

    private static async Task<int> RunListContentsAsync(
        IReadOnlyList<string> args,
        CancellationToken cancellationToken
    ) {
        AutomationListContentsCliOptions options;
        try {
            options = AutomationListContentsCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationModelDiscoveryService();
        AutomationContentCatalogResult result;
        try {
            result = await service.ListContentsAsync(
                options.ToOptions(),
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return 0;
    }

    private static async Task<int> RunDiscoverModelsAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationDiscoverModelsCliOptions options;
        try {
            options = AutomationDiscoverModelsCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationModelDiscoveryService();
        ModelDiscoveryResult result;
        try {
            result = await service.DiscoverModelsAsync(
                options.ToOptions(),
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return 0;
    }

    private static async Task<int> RunCollectParametersAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationParameterCollectionCliOptions options;
        try {
            options = AutomationParameterCollectionCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationParameterCollectionService();
        ParameterCollectionResult result;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(GetProbeLifetime(options.TimeoutSeconds));
        try {
            result = await service.RunAsync(
                options.ToOptions(),
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                timeoutCts.Token
            );
        } catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested) {
            result = new ParameterCollectionResult {
                Succeeded = false,
                Classification = ParameterCollectionClassification.TimedOut,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage =
                    $"Automation parameter collection exceeded the process timeout of {(int)GetProbeLifetime(options.TimeoutSeconds).TotalSeconds} seconds and was cancelled."
            };
        } catch (Exception ex) {
            result = new ParameterCollectionResult {
                Succeeded = false,
                Classification = ParameterCollectionClassification.WorkItemSubmissionFailed,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage = ex.Message
            };
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return GetExitCode(result.Classification);
    }

    private static async Task<int> RunCollectParametersBatchAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationParameterCollectionBatchCliOptions options;
        try {
            options = AutomationParameterCollectionBatchCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationParameterCollectionBatchService();
        ParameterCollectionBatchResult result;
        try {
            result = await service.RunAsync(
                options.ManifestPath,
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return result.FailureCount == 0 ? 0 : 24;
    }

    private static async Task<int> RunCollectSchedulesAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationScheduleCollectionCliOptions options;
        try {
            options = AutomationScheduleCollectionCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationScheduleCollectionService();
        ScheduleCollectionResult result;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(GetProbeLifetime(options.TimeoutSeconds));
        try {
            result = await service.RunAsync(
                options.ToOptions(),
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                timeoutCts.Token
            );
        } catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested) {
            result = new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.TimedOut,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage =
                    $"Automation schedule collection exceeded the process timeout of {(int)GetProbeLifetime(options.TimeoutSeconds).TotalSeconds} seconds and was cancelled."
            };
        } catch (Exception ex) {
            result = new ScheduleCollectionResult {
                Succeeded = false,
                Classification = ScheduleCollectionClassification.WorkItemSubmissionFailed,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage = ex.Message
            };
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return GetExitCode(result.Classification);
    }

    private static async Task<int> RunCollectSchedulesBatchAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationScheduleCollectionBatchCliOptions options;
        try {
            options = AutomationScheduleCollectionBatchCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationScheduleCollectionBatchService();
        ScheduleCollectionBatchResult result;
        try {
            result = await service.RunAsync(
                options.ManifestPath,
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                cancellationToken
            );
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result);

        return result.FailureCount == 0 ? 0 : 24;
    }

    private static async Task<int> RunProbeAccessAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        AutomationProbeAccessCliOptions options;
        try {
            options = AutomationProbeAccessCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationProbeService();
        ProbeAccessResult result;
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(GetProbeLifetime(options.TimeoutSeconds));
        try {
            result = await service.RunAsync(
                options.ToProbeAccessOptions(),
                repoRootOverride,
                message => {
                    if (!options.Json)
                        Console.WriteLine(message);
                },
                timeoutCts.Token
            );
        } catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested) {
            result = new ProbeAccessResult {
                Succeeded = false,
                Classification = ProbeAccessClassification.TimedOut,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage =
                    $"Automation probe exceeded the process timeout of {(int)GetProbeLifetime(options.TimeoutSeconds).TotalSeconds} seconds and was cancelled."
            };
        } catch (Exception ex) {
            result = new ProbeAccessResult {
                Succeeded = false,
                Classification = ProbeAccessClassification.WorkItemSubmissionFailed,
                Engine = options.Engine,
                Region = options.Region,
                ProjectGuid = options.ProjectGuid,
                ModelGuid = options.ModelGuid,
                FailureMessage = ex.Message
            };
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result, options.Mask);

        return GetExitCode(result.Classification);
    }

    private static async Task<int> RunWorkItemStatusAsync(
        IReadOnlyList<string> args,
        CancellationToken cancellationToken
    ) {
        AutomationWorkItemCliOptions options;
        try {
            options = AutomationWorkItemCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            WriteAutomationUsage();
            return 10;
        }

        var service = new RevitAutomationWorkItemInspectorService();
        AutomationWorkItemInspectResult result;
        try {
            result = await service.RunAsync(options.ToInspectOptions(), cancellationToken);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }

        if (options.Json)
            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
        else
            WriteHumanResult(result, options.Mask);

        return 0;
    }

    private static TimeSpan GetProbeLifetime(int timeoutSeconds) {
        var requestedLifetime = TimeSpan.FromSeconds(timeoutSeconds) + ProbeTimeoutBuffer;
        return requestedLifetime > MinimumProbeLifetime ? requestedLifetime : MinimumProbeLifetime;
    }

    private static void WriteHumanResult(ProbeAccessResult result, bool mask) {
        Console.WriteLine($"Classification: {result.Classification}");
        Console.WriteLine($"Engine: {result.Engine}");
        Console.WriteLine($"Region: {result.Region}");
        Console.WriteLine($"Project: {DisplayGuid(result.ProjectGuid, mask)}");
        Console.WriteLine($"Model: {DisplayGuid(result.ModelGuid, mask)}");
        if (!string.IsNullOrWhiteSpace(result.WorkItemId))
            Console.WriteLine($"Workitem: {result.WorkItemId}");
        if (!string.IsNullOrWhiteSpace(result.DocumentTitle))
            Console.WriteLine($"Document: {result.DocumentTitle}");
        if (!string.IsNullOrWhiteSpace(result.FailureMessage))
            Console.WriteLine($"Failure: {result.FailureMessage}");
        if (!string.IsNullOrWhiteSpace(result.RawReportExcerpt)) {
            Console.WriteLine("Report:");
            Console.WriteLine(result.RawReportExcerpt);
        }
    }

    private static void WriteHumanResult(AutomationWorkItemInspectResult result, bool mask) {
        Console.WriteLine($"Workitem: {DisplayId(result.WorkItemId, mask)}");
        Console.WriteLine($"Status: {result.Status ?? "(unknown)"}");
        if (!string.IsNullOrWhiteSpace(result.ReportUrl))
            Console.WriteLine($"ReportUrl: {result.ReportUrl}");
        if (result.Classification is not null)
            Console.WriteLine($"Classification: {result.Classification}");
        if (!string.IsNullOrWhiteSpace(result.DocumentTitle))
            Console.WriteLine($"Document: {result.DocumentTitle}");
        if (!string.IsNullOrWhiteSpace(result.FailureMessage))
            Console.WriteLine($"Failure: {result.FailureMessage}");
        if (!string.IsNullOrWhiteSpace(result.ArtifactLocalName))
            Console.WriteLine($"ArtifactLocalName: {result.ArtifactLocalName}");
        if (!string.IsNullOrWhiteSpace(result.RawReportExcerpt)) {
            Console.WriteLine("Report:");
            Console.WriteLine(result.RawReportExcerpt);
        }
    }

    private static void WriteHumanResult(ParameterCollectionResult result) {
        Console.WriteLine($"Classification: {result.Classification}");
        Console.WriteLine($"Engine: {result.Engine}");
        Console.WriteLine($"Region: {result.Region}");
        Console.WriteLine($"Project: {result.ProjectGuid}");
        Console.WriteLine($"Model: {result.ModelGuid}");
        if (!string.IsNullOrWhiteSpace(result.WorkItemId))
            Console.WriteLine($"Workitem: {result.WorkItemId}");
        if (!string.IsNullOrWhiteSpace(result.DocumentTitle))
            Console.WriteLine($"Document: {result.DocumentTitle}");
        if (!string.IsNullOrWhiteSpace(result.ArtifactLocalPath))
            Console.WriteLine($"Artifact: {result.ArtifactLocalPath}");
        if (!string.IsNullOrWhiteSpace(result.FailureMessage))
            Console.WriteLine($"Failure: {result.FailureMessage}");
        if (!string.IsNullOrWhiteSpace(result.RawReportExcerpt)) {
            Console.WriteLine("Report:");
            Console.WriteLine(result.RawReportExcerpt);
        }
    }

    private static void WriteHumanResult(ParameterCollectionBatchResult result) {
        Console.WriteLine($"Manifest: {result.ManifestPath}");
        Console.WriteLine($"Models: {result.TotalModelCount}");
        Console.WriteLine($"Succeeded: {result.SuccessCount}");
        Console.WriteLine($"Failed: {result.FailureCount}");
        foreach (var item in result.Results) {
            Console.WriteLine(
                $"{item.Classification}: {item.Region} {DisplayId(item.ProjectGuid, true)} {DisplayId(item.ModelGuid, true)}" +
                (string.IsNullOrWhiteSpace(item.ArtifactLocalPath) ? "" : $" -> {item.ArtifactLocalPath}")
            );
        }
    }

    private static void WriteHumanResult(ScheduleCollectionResult result) {
        Console.WriteLine($"Classification: {result.Classification}");
        Console.WriteLine($"Engine: {result.Engine}");
        Console.WriteLine($"Region: {result.Region}");
        Console.WriteLine($"Project: {result.ProjectGuid}");
        Console.WriteLine($"Model: {result.ModelGuid}");
        if (!string.IsNullOrWhiteSpace(result.WorkItemId))
            Console.WriteLine($"Workitem: {result.WorkItemId}");
        if (!string.IsNullOrWhiteSpace(result.DocumentTitle))
            Console.WriteLine($"Document: {result.DocumentTitle}");
        if (!string.IsNullOrWhiteSpace(result.ArtifactLocalPath))
            Console.WriteLine($"Artifact: {result.ArtifactLocalPath}");
        if (!string.IsNullOrWhiteSpace(result.FailureMessage))
            Console.WriteLine($"Failure: {result.FailureMessage}");
        if (!string.IsNullOrWhiteSpace(result.RawReportExcerpt)) {
            Console.WriteLine("Report:");
            Console.WriteLine(result.RawReportExcerpt);
        }
    }

    private static void WriteHumanResult(ScheduleCollectionBatchResult result) {
        Console.WriteLine($"Manifest: {result.ManifestPath}");
        Console.WriteLine($"Models: {result.TotalModelCount}");
        Console.WriteLine($"Succeeded: {result.SuccessCount}");
        Console.WriteLine($"Failed: {result.FailureCount}");
        foreach (var item in result.Results) {
            Console.WriteLine(
                $"{item.Classification}: {item.Region} {DisplayId(item.ProjectGuid, true)} {DisplayId(item.ModelGuid, true)}" +
                (string.IsNullOrWhiteSpace(item.ArtifactLocalPath) ? "" : $" -> {item.ArtifactLocalPath}")
            );
        }
    }

    private static void WriteHumanResult(AutomationHubCatalogResult result) {
        Console.WriteLine($"Hubs: {result.Hubs.Count}");
        foreach (var hub in result.Hubs)
            Console.WriteLine($"{hub.Id} [{hub.Region ?? "?"}] {hub.Name}");
    }

    private static void WriteHumanResult(AutomationProjectCatalogResult result) {
        Console.WriteLine($"Hub: {result.HubId}");
        Console.WriteLine($"Projects: {result.Projects.Count}");
        foreach (var project in result.Projects)
            Console.WriteLine($"{project.Id} {project.Name}");
    }

    private static void WriteHumanResult(AutomationContentCatalogResult result) {
        Console.WriteLine($"Hub: {result.HubId}");
        Console.WriteLine($"Project: {result.ProjectId}");
        Console.WriteLine($"Scope: {result.ScopeName}");
        Console.WriteLine($"Entries: {result.Entries.Count}");
        foreach (var entry in result.Entries) {
            var kind = entry.IsFolder ? "Folder" : "Item";
            Console.WriteLine($"{kind}: {entry.Id} {entry.Name}");
        }
    }

    private static void WriteHumanResult(ModelDiscoveryResult result) {
        Console.WriteLine($"Hub: {result.HubName} ({result.HubId})");
        Console.WriteLine($"Project: {result.ProjectName} ({result.ProjectId})");
        Console.WriteLine($"Region: {result.Region}");
        Console.WriteLine($"Scope: {result.ScopePath}");
        Console.WriteLine($"Recursive: {result.Recursive}");
        if (!string.IsNullOrWhiteSpace(result.NameContains))
            Console.WriteLine($"NameContains: {result.NameContains}");
        Console.WriteLine($"Models: {result.ModelCount}");
        if (!string.IsNullOrWhiteSpace(result.ManifestPath))
            Console.WriteLine($"Manifest: {result.ManifestPath}");
        foreach (var model in result.Models) {
            Console.WriteLine(
                $"{model.DisplayName} | {model.ProjectGuid} | {model.ModelGuid} | {model.FolderPath}" +
                (string.IsNullOrWhiteSpace(model.SuggestedExpectedTitle)
                    ? ""
                    : $" | expectedTitle={model.SuggestedExpectedTitle}")
            );
        }
    }

    private static string DisplayGuid(string value, bool mask) {
        if (!mask || value.Length <= 12)
            return value;

        return $"{value[..8]}...{value[^4..]}";
    }

    private static string DisplayId(string value, bool mask) {
        if (!mask || value.Length <= 12)
            return value;

        return $"{value[..8]}...{value[^4..]}";
    }

    private static int WriteAutomationUsageAndReturn() {
        WriteAutomationUsage();
        return 10;
    }

    private static void WriteAutomationUsage() {
        Console.Error.WriteLine(AutomationListHubsCliOptions.UsageText);
        Console.Error.WriteLine(AutomationListProjectsCliOptions.UsageText);
        Console.Error.WriteLine(AutomationListContentsCliOptions.UsageText);
        Console.Error.WriteLine(AutomationDiscoverModelsCliOptions.UsageText);
        Console.Error.WriteLine(AutomationParameterCollectionCliOptions.UsageText);
        Console.Error.WriteLine(AutomationParameterCollectionBatchCliOptions.UsageText);
        Console.Error.WriteLine(AutomationScheduleCollectionCliOptions.UsageText);
        Console.Error.WriteLine(AutomationScheduleCollectionBatchCliOptions.UsageText);
        Console.Error.WriteLine(AutomationProbeAccessCliOptions.UsageText);
        Console.Error.WriteLine(AutomationWorkItemCliOptions.UsageText);
    }

    private static int GetExitCode(ProbeAccessClassification classification) =>
        classification switch {
            ProbeAccessClassification.Success => 0,
            ProbeAccessClassification.ManagementTokenFailed => 11,
            ProbeAccessClassification.UserTokenFailed => 12,
            ProbeAccessClassification.WorkItemSubmissionUnauthorized => 13,
            ProbeAccessClassification.WorkItemSubmissionFailed => 14,
            ProbeAccessClassification.CloudModelUnauthorized => 21,
            ProbeAccessClassification.CloudModelNotFound => 22,
            ProbeAccessClassification.CloudModelOpenFailed => 23,
            ProbeAccessClassification.TimedOut => 24,
            _ => 1
        };

    private static int GetExitCode(ParameterCollectionClassification classification) =>
        classification switch {
            ParameterCollectionClassification.Success => 0,
            ParameterCollectionClassification.ManagementTokenFailed => 11,
            ParameterCollectionClassification.UserTokenFailed => 12,
            ParameterCollectionClassification.ArtifactTokenFailed => 13,
            ParameterCollectionClassification.WorkItemSubmissionUnauthorized => 14,
            ParameterCollectionClassification.WorkItemSubmissionFailed => 15,
            ParameterCollectionClassification.CloudModelUnauthorized => 21,
            ParameterCollectionClassification.CloudModelNotFound => 22,
            ParameterCollectionClassification.CollectionFailed => 23,
            ParameterCollectionClassification.ArtifactDownloadFailed => 24,
            ParameterCollectionClassification.TimedOut => 25,
            _ => 1
        };

    private static int GetExitCode(ScheduleCollectionClassification classification) =>
        classification switch {
            ScheduleCollectionClassification.Success => 0,
            ScheduleCollectionClassification.ManagementTokenFailed => 11,
            ScheduleCollectionClassification.UserTokenFailed => 12,
            ScheduleCollectionClassification.ArtifactTokenFailed => 13,
            ScheduleCollectionClassification.WorkItemSubmissionUnauthorized => 14,
            ScheduleCollectionClassification.WorkItemSubmissionFailed => 15,
            ScheduleCollectionClassification.CloudModelUnauthorized => 21,
            ScheduleCollectionClassification.CloudModelNotFound => 22,
            ScheduleCollectionClassification.CollectionFailed => 23,
            ScheduleCollectionClassification.ArtifactDownloadFailed => 24,
            ScheduleCollectionClassification.TimedOut => 25,
            _ => 1
        };
}
