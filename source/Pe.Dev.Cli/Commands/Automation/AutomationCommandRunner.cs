using Pe.Shared.ApsAuth;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Dev.RevitAutomation;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime;
using static Pe.Aps.Aps;

namespace Pe.Dev.Cli;

internal static class AutomationCommandRunner {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static Task<int> RunAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) =>
        args.Count == 0
            ? Task.FromResult(WriteAutomationUsageAndReturn())
            : args[0].ToLowerInvariant() switch {
                "auth" => RunAuthAsync(args),
                "browse" => RunBrowseAsync(args, repoRootOverride, cancellationToken),
                "manifest" => RunManifestAsync(args, repoRootOverride, cancellationToken),
                "submit" => RunSubmitAsync(args, repoRootOverride, cancellationToken),
                "inspect" => RunInspectAsync(args, repoRootOverride, cancellationToken),
                "cache" => RunCacheAsync(args, repoRootOverride),
                _ => Task.FromResult(WriteAutomationUsageAndReturn())
            };

    private static Task<int> RunAuthAsync(
        IReadOnlyList<string> args
    ) {
        if (args.Count < 2)
            return Task.FromResult(WriteAutomationUsageAndReturn());

        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);
        var credentials = new ApsCredentialSource().ReadCredentials();
        var service = new ApsAuthService(new StaticAuthTokenProvider(credentials.WebClientId, credentials.WebClientSecret));
        var request = ApsTokenRequest.ForAutomationUserContext();
        try {
            switch (args[1].ToLowerInvariant()) {
            case "login": {
                var result = service.Login(request, message => WriteAutomationProgress(message, json));
                WriteResult(result, json);
                return Task.FromResult(0);
            }
            case "status":
                WriteResult(service.GetStatus(request), json);
                return Task.FromResult(0);
            case "logout":
                service.Logout();
                if (json)
                    Console.WriteLine("{\"loggedOut\":true}");
                else
                    Console.WriteLine("Persisted APS auth cleared.");
                return Task.FromResult(0);
            default:
                return Task.FromResult(WriteAutomationUsageAndReturn());
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return Task.FromResult(14);
        }
    }

    private static async Task<int> RunBrowseAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count < 2)
            return WriteAutomationUsageAndReturn();

        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var service = new AutomationBrowseService();
        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);
        var refresh = args.Contains("--refresh", StringComparer.OrdinalIgnoreCase);

        try {
            switch (args[1].ToLowerInvariant()) {
            case "status":
                WriteResult(service.GetContext(repoRoot), json);
                return 0;
            case "hubs":
                WriteResult(
                    await service.GetHubsAsync(repoRoot, refresh, message => WriteAutomationProgress(message, json), cancellationToken)
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            case "use-hub":
                WriteResult(
                    await service.UseHubAsync(
                            repoRoot,
                            RequirePositional(args, 2, "hub selector"),
                            refresh,
                            message => WriteAutomationProgress(message, json),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            case "projects":
                WriteResult(
                    await service.GetProjectsAsync(repoRoot, refresh, message => WriteAutomationProgress(message, json), cancellationToken)
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            case "use-project":
                WriteResult(
                    await service.UseProjectAsync(
                            repoRoot,
                            RequirePositional(args, 2, "project selector"),
                            refresh,
                            message => WriteAutomationProgress(message, json),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            case "pwd":
                if (json)
                    Console.WriteLine(JsonSerializer.Serialize(new { scopePath = service.GetWorkingPath(repoRoot) }, JsonOptions));
                else
                    Console.WriteLine(string.IsNullOrWhiteSpace(service.GetWorkingPath(repoRoot)) ? "/" : service.GetWorkingPath(repoRoot));
                return 0;
            case "ls": {
                var scopePath = TryReadOptionalPositional(args, 2);
                var result = await service.ListContentsAsync(
                        repoRoot,
                        scopePath,
                        refresh,
                        message => WriteAutomationProgress(message, json),
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                WriteResult(result, json);
                return 0;
            }
            case "cd":
                WriteResult(
                    await service.ChangeDirectoryAsync(
                            repoRoot,
                            RequirePositional(args, 2, "folder name"),
                            refresh,
                            message => WriteAutomationProgress(message, json),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            case "up":
                WriteResult(service.MoveUp(repoRoot), json);
                return 0;
            case "models":
                WriteResult(
                    await service.ListModelsAsync(
                            repoRoot,
                            ReadOptionValue(args, "--name-contains"),
                            ReadBooleanOption(args, "--recurse", true),
                            refresh,
                            ReadOptionValue(args, "--out"),
                            message => WriteAutomationProgress(message, json),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            default:
                return WriteAutomationUsageAndReturn();
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }
    }

    private static async Task<int> RunManifestAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count < 2)
            return WriteAutomationUsageAndReturn();

        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var service = new AutomationManifestService();
        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);
        var refresh = args.Contains("--refresh", StringComparer.OrdinalIgnoreCase);
        try {
            switch (args[1].ToLowerInvariant()) {
            case "create":
                WriteResult(service.Create(repoRoot, RequireOptionValue(args, "--path")), json);
                return 0;
            case "show":
                WriteResult(service.Load(repoRoot, RequireOptionValue(args, "--path")), json);
                return 0;
            case "list": {
                var manifest = service.Load(repoRoot, RequireOptionValue(args, "--path"));
                if (json) {
                    Console.WriteLine(JsonSerializer.Serialize(manifest.Models, JsonOptions));
                } else {
                    Console.WriteLine($"Hub: {manifest.Hub}");
                    Console.WriteLine($"Models: {manifest.Models.Count}");
                    foreach (var model in manifest.Models)
                        Console.WriteLine($"- {model.Project} :: {model.ModelPath}");
                }

                return 0;
            }
            case "add":
                WriteResult(
                    service.AddModel(
                        repoRoot,
                        RequireOptionValue(args, "--path"),
                        RequireOptionValue(args, "--project"),
                        RequireOptionValue(args, "--model-path"),
                        refresh,
                        message => WriteAutomationProgress(message, json),
                        cancellationToken
                    ),
                    json
                );
                return 0;
            case "remove":
                WriteResult(
                    service.RemoveModel(
                        repoRoot,
                        RequireOptionValue(args, "--path"),
                        RequireOptionValue(args, "--model-path")
                    ),
                    json
                );
                return 0;
            case "set-request": {
                var request = BuildScheduleRequest(args);
                WriteResult(
                    service.SetRequest(repoRoot, RequireOptionValue(args, "--path"), request),
                    json
                );
                return 0;
            }
            case "validate":
                WriteResult(
                    await service.ValidateAsync(
                            repoRoot,
                            RequireOptionValue(args, "--path"),
                            refresh,
                            message => WriteAutomationProgress(message, json),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            default:
                return WriteAutomationUsageAndReturn();
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }
    }

    private static async Task<int> RunSubmitAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count < 2 || !string.Equals(args[1], "schedules", StringComparison.OrdinalIgnoreCase))
            return WriteAutomationUsageAndReturn();

        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);
        var service = new AutomationScheduleSubmissionService();
        try {
            var result = await service.RunAsync(
                    RequireOptionValue(args, "--manifest"),
                    ReadOptionValue(args, "--receipt"),
                    args.Contains("--refresh", StringComparer.OrdinalIgnoreCase),
                    repoRootOverride,
                    message => WriteAutomationProgress(message, json),
                    cancellationToken
                )
                .ConfigureAwait(false);
            WriteResult(result, json);
            return result.FailureCount == 0 ? 0 : 24;
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }
    }

    private static async Task<int> RunInspectAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count < 2)
            return WriteAutomationUsageAndReturn();

        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);
        var service = new AutomationReceiptInspectionService();
        try {
            switch (args[1].ToLowerInvariant()) {
            case "receipt": {
                var result = await service.InspectReceiptAsync(
                        RequireOptionValue(args, "--receipt"),
                        args.Contains("--refresh", StringComparer.OrdinalIgnoreCase),
                        ReadBooleanOption(args, "--download-artifacts", true),
                        repoRootOverride,
                        message => WriteAutomationProgress(message, json),
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                if (json)
                    Console.WriteLine(JsonSerializer.Serialize(new { result.ReceiptPath, result.Receipt }, JsonOptions));
                else
                    WriteHumanResult(result.ReceiptPath, result.Receipt);
                return 0;
            }
            case "workitem":
                WriteResult(
                    await service.InspectWorkItemAsync(
                            RequireOptionValue(args, "--workitem-id"),
                            ReadBooleanOption(args, "--include-report", true),
                            cancellationToken
                        )
                        .ConfigureAwait(false),
                    json
                );
                return 0;
            default:
                return WriteAutomationUsageAndReturn();
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 14;
        }
    }

    private static Task<int> RunCacheAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride
    ) {
        if (args.Count < 2)
            return Task.FromResult(WriteAutomationUsageAndReturn());

        var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        var service = new AutomationBrowseService();
        var json = args.Contains("--json", StringComparer.OrdinalIgnoreCase);

        try {
            switch (args[1].ToLowerInvariant()) {
            case "status":
                WriteResult(service.GetCacheStatus(repoRoot), json);
                return Task.FromResult(0);
            case "clear": {
                var scope = (ReadOptionValue(args, "--scope") ?? "").ToLowerInvariant() switch {
                    "" => AutomationCacheScope.All,
                    "hubs" => AutomationCacheScope.Hubs,
                    "projects" => AutomationCacheScope.Projects,
                    "contents" => AutomationCacheScope.Contents,
                    "models" => AutomationCacheScope.Models,
                    var value => throw new InvalidOperationException($"Unknown cache scope '{value}'.")
                };
                service.ClearCache(repoRoot, scope);
                if (json)
                    Console.WriteLine(JsonSerializer.Serialize(new { cleared = scope.ToString() }, JsonOptions));
                else
                    Console.WriteLine($"Cleared cache scope: {scope}");
                return Task.FromResult(0);
            }
            default:
                return Task.FromResult(WriteAutomationUsageAndReturn());
            }
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return Task.FromResult(14);
        }
    }

    private static ScheduleCollectionBatchRequest BuildScheduleRequest(IReadOnlyList<string> args) {
        var includeTemplates = ReadBooleanOption(args, "--include-templates", false);
        var primaryParameterName = ReadOptionValue(args, "--primary-parameter-name") ?? ScheduleCollectionDefaults.DefaultPrimaryParameterName;
        var primaryValue = ReadOptionValue(args, "--primary-value") ?? ScheduleCollectionDefaults.DefaultPrimaryParameterValue;
        var primaryCategoryNames = ReadRepeatedOptionValues(args, "--primary-category-name");
        var primaryScheduleNames = ReadRepeatedOptionValues(args, "--primary-schedule-name");
        var fallbackCategoryNames = ReadRepeatedOptionValues(args, "--fallback-category-name");
        var fallbackScheduleNames = ReadRepeatedOptionValues(args, "--fallback-schedule-name");

        if (fallbackCategoryNames.Count == 0)
            fallbackCategoryNames.AddRange(ScheduleCollectionDefaults.CreateDefaultFallbackCatalogRequest().CategoryNames);

        return new ScheduleCollectionBatchRequest {
            PrimaryCatalogRequest = new ScheduleCatalogBatchRequest {
                CategoryNames = primaryCategoryNames,
                ScheduleNames = primaryScheduleNames,
                CustomParameterFilters = string.IsNullOrWhiteSpace(primaryParameterName) || string.IsNullOrWhiteSpace(primaryValue)
                    ? []
                    : [
                        new ScheduleCustomParameterFilter(
                            ParameterReference.FromName(primaryParameterName),
                            primaryValue,
                            ScheduleCustomParameterMatchKind.Equals
                        )
                    ],
                IncludeTemplates = includeTemplates
            },
            FallbackCatalogRequest = new ScheduleCatalogBatchRequest {
                CategoryNames = fallbackCategoryNames,
                ScheduleNames = fallbackScheduleNames,
                IncludeTemplates = includeTemplates
            }
        };
    }

    private static string RequireOptionValue(IReadOnlyList<string> args, string optionName) =>
        ReadOptionValue(args, optionName)
        ?? throw new ArgumentException($"Missing required argument `{optionName}`.");

    private static string? ReadOptionValue(IReadOnlyList<string> args, string optionName) {
        for (var i = 0; i < args.Count - 1; i++) {
            if (string.Equals(args[i], optionName, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }

        return null;
    }

    private static List<string> ReadRepeatedOptionValues(IReadOnlyList<string> args, string optionName) {
        var values = new List<string>();
        for (var i = 0; i < args.Count - 1; i++) {
            if (string.Equals(args[i], optionName, StringComparison.OrdinalIgnoreCase))
                values.Add(args[i + 1]);
        }

        return values;
    }

    private static bool ReadBooleanOption(IReadOnlyList<string> args, string optionName, bool defaultValue) {
        for (var i = 0; i < args.Count; i++) {
            if (!string.Equals(args[i], optionName, StringComparison.OrdinalIgnoreCase))
                continue;

            if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal))
                return defaultValue;

            return bool.Parse(args[i + 1]);
        }

        return defaultValue;
    }

    private static string RequirePositional(IReadOnlyList<string> args, int index, string label) =>
        index < args.Count && !args[index].StartsWith("--", StringComparison.Ordinal)
            ? args[index]
            : throw new ArgumentException($"Missing required {label}.");

    private static string? TryReadOptionalPositional(IReadOnlyList<string> args, int index) =>
        index < args.Count && !args[index].StartsWith("--", StringComparison.Ordinal) ? args[index] : null;

    private static void WriteResult(object value, bool json) {
        if (json) {
            Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
            return;
        }

        switch (value) {
        case ApsPersistedTokenStatus status:
            Console.WriteLine($"Persisted auth: {(status.Exists ? "present" : "missing")}");
            Console.WriteLine($"Flow: {status.FlowKind}");
            Console.WriteLine($"Scope: {status.ScopeProfile}");
            Console.WriteLine($"Has refresh token: {status.HasRefreshToken}");
            Console.WriteLine($"Expires at (UTC): {(status.ExpiresAtUtc.HasValue ? status.ExpiresAtUtc.Value.ToString("O") : "(unknown)")}");
            break;
        case AutomationBrowseContext context:
            Console.WriteLine($"Hub: {context.HubName ?? "(none)"}");
            Console.WriteLine($"Project: {context.ProjectName ?? "(none)"}");
            Console.WriteLine($"Path: {(string.IsNullOrWhiteSpace(context.ScopePath) ? "/" : context.ScopePath)}");
            break;
        case AutomationHubCatalogResult hubs:
            foreach (var hub in hubs.Hubs)
                Console.WriteLine($"{hub.Name} [{hub.Id}]");
            break;
        case AutomationProjectCatalogResult projects:
            foreach (var project in projects.Projects)
                Console.WriteLine($"{project.Name} [{project.Id}]");
            break;
        case AutomationContentCatalogResult contents:
            Console.WriteLine($"Scope: {contents.ScopeName}");
            foreach (var entry in contents.Entries)
                Console.WriteLine($"{(entry.IsFolder ? "dir " : "file")} {entry.Name}");
            break;
        case AutomationModelInventoryResult inventory:
            Console.WriteLine($"Project: {inventory.ProjectName}");
            Console.WriteLine($"Scope: {(string.IsNullOrWhiteSpace(inventory.ScopePath) ? "/" : inventory.ScopePath)}");
            Console.WriteLine($"Models: {inventory.Models.Count}");
            foreach (var model in inventory.Models)
                Console.WriteLine($"- {model.ModelPath} [year {model.RevitYear?.ToString() ?? "?"}]");
            break;
        case ScheduleAuditManifest manifest:
            Console.WriteLine($"Hub: {manifest.Hub}");
            Console.WriteLine($"Models: {manifest.Models.Count}");
            break;
        case AutomationManifestValidationResult validation:
            Console.WriteLine($"Manifest: {validation.ManifestPath}");
            Console.WriteLine($"Valid: {validation.IsValid}");
            foreach (var entry in validation.Entries) {
                Console.WriteLine(
                    entry.IsValid
                        ? $"+ {entry.Project} :: {entry.ModelPath} -> source {entry.SourceRevitYear} ({entry.YearResolutionSource}), exec {entry.ExecutionRevitYear}, {entry.ProcessingMode}"
                        : $"- {entry.Project} :: {entry.ModelPath} :: {entry.FailureMessage}"
                );
            }

            break;
        case AutomationScheduleSubmitResult submit:
            Console.WriteLine($"Receipt: {submit.ReceiptPath}");
            Console.WriteLine($"Submitted: {submit.SubmittedCount}");
            Console.WriteLine($"Submission failures: {submit.FailureCount}");
            foreach (var entry in submit.Receipt.Entries) {
                Console.WriteLine(
                    $"{entry.Project} :: {entry.ModelPath} :: {entry.Status}" +
                    (entry.ExecutionRevitYear.HasValue ? $" [exec {entry.ExecutionRevitYear}]" : "") +
                    (entry.ProcessingMode.HasValue ? $" [{entry.ProcessingMode}]" : "") +
                    (string.IsNullOrWhiteSpace(entry.WorkItemId) ? "" : $" [workitem {entry.WorkItemId}]")
                );
            }

            break;
        case AutomationWorkItemInspectResult inspect:
            Console.WriteLine($"Workitem: {inspect.WorkItemId}");
            Console.WriteLine($"Status: {inspect.Status}");
            if (!string.IsNullOrWhiteSpace(inspect.Classification))
                Console.WriteLine($"Classification: {inspect.Classification}");
            if (!string.IsNullOrWhiteSpace(inspect.DocumentTitle))
                Console.WriteLine($"DocumentTitle: {inspect.DocumentTitle}");
            if (!string.IsNullOrWhiteSpace(inspect.FailureMessage))
                Console.WriteLine($"Failure: {inspect.FailureMessage}");
            break;
        case AutomationCacheStatus cache:
            Console.WriteLine($"Root: {cache.RootPath}");
            Console.WriteLine($"Hubs cached: {cache.HubsExists}");
            Console.WriteLine($"Project cache files: {cache.ProjectCacheFileCount}");
            Console.WriteLine($"Content cache files: {cache.ContentsCacheFileCount}");
            Console.WriteLine($"Model cache files: {cache.ModelsCacheFileCount}");
            break;
        default:
            Console.WriteLine(Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented));
            break;
        }
    }

    private static void WriteHumanResult(string receiptPath, AutomationRunReceipt receipt) {
        Console.WriteLine($"Receipt: {receiptPath}");
        foreach (var entry in receipt.Entries) {
            Console.WriteLine(
                $"{entry.Project} :: {entry.ModelPath} :: {entry.Status}" +
                (entry.ExecutionRevitYear.HasValue ? $" [exec {entry.ExecutionRevitYear}]" : "") +
                (entry.ProcessingMode.HasValue ? $" [{entry.ProcessingMode}]" : "") +
                (string.IsNullOrWhiteSpace(entry.WorkItemId) ? "" : $" [workitem {entry.WorkItemId}]") +
                (string.IsNullOrWhiteSpace(entry.ArtifactLocalPath) ? "" : $" -> {entry.ArtifactLocalPath}")
            );
        }
    }

    private static void WriteAutomationProgress(string message, bool json) {
        if (json)
            Console.Error.WriteLine(message);
        else
            Console.WriteLine(message);
    }

    private static int WriteAutomationUsageAndReturn() {
        WriteAutomationUsage();
        return 10;
    }

    private static void WriteAutomationUsage() {
        Console.Error.WriteLine(
            """
            Usage:
              pe-dev automation auth login [--json]
              pe-dev automation auth status [--json]
              pe-dev automation auth logout
              pe-dev automation browse status [--json]
              pe-dev automation browse hubs [--refresh] [--json]
              pe-dev automation browse use-hub <hub-name-or-id> [--refresh] [--json]
              pe-dev automation browse projects [--refresh] [--json]
              pe-dev automation browse use-project <project-name-or-id> [--refresh] [--json]
              pe-dev automation browse pwd [--json]
              pe-dev automation browse ls [<path>] [--refresh] [--json]
              pe-dev automation browse cd <folder-name> [--refresh] [--json]
              pe-dev automation browse up [--json]
              pe-dev automation browse models [--name-contains <text>] [--recurse <true|false>] [--refresh] [--out <path>] [--json]
              pe-dev automation manifest create --path <manifest-path> [--json]
              pe-dev automation manifest show --path <manifest-path> [--json]
              pe-dev automation manifest list --path <manifest-path> [--json]
              pe-dev automation manifest add --path <manifest-path> --project <project-name> --model-path <project-root-model-path> [--refresh] [--json]
              pe-dev automation manifest remove --path <manifest-path> --model-path <project-root-model-path> [--json]
              pe-dev automation manifest set-request --path <manifest-path> [--primary-parameter-name <name>] [--primary-value <value>] [--primary-category-name <name>]... [--primary-schedule-name <name>]... [--fallback-category-name <name>]... [--fallback-schedule-name <name>]... [--include-templates <true|false>] [--json]
              pe-dev automation manifest validate --path <manifest-path> [--refresh] [--json]
              pe-dev automation submit schedules --manifest <manifest-path> [--receipt <receipt-path>] [--refresh] [--json]
              pe-dev automation inspect receipt --receipt <path|latest> [--refresh] [--download-artifacts <true|false>] [--json]
              pe-dev automation inspect workitem --workitem-id <id> [--include-report <true|false>] [--json]
              pe-dev automation cache status [--json]
              pe-dev automation cache clear [--scope hubs|projects|contents|models] [--json]
            """
        );
    }
}
