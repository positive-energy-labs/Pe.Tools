using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Net.Http.Json;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;

var exitCode = await ScriptCliProgram.RunAsync(args, CancellationToken.None);
Environment.Exit(exitCode);

internal static class ScriptCliProgram {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken) {
        CliParseResult parseResult;
        try {
            parseResult = CliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine(CliOptions.UsageText);
            return 10;
        }

        if (!parseResult.Success || parseResult.Options == null) {
            if (!string.IsNullOrWhiteSpace(parseResult.ErrorMessage))
                Console.Error.WriteLine(parseResult.ErrorMessage);

            if (parseResult.ShowUsage)
                Console.Error.WriteLine(CliOptions.UsageText);

            return 10;
        }

        var options = parseResult.Options;
        if (options.CommandKind == CliCommandKind.CreateNewFile) {
            var createResult = CreateWorkspaceScriptFile(
                CliOptions.GetWorkspaceRoot(options.WorkspaceKey),
                options.WorkspaceRelativePath ?? throw new InvalidOperationException("Workspace path is required."),
                overwriteExisting: false
            );
            if (!createResult.Success) {
                Console.Error.WriteLine(createResult.Message);
                return 10;
            }

            Console.Out.WriteLine(createResult.Message);
            if (!string.IsNullOrWhiteSpace(createResult.WarningMessage))
                Console.Error.WriteLine(createResult.WarningMessage);

            return 0;
        }

        ExecuteRevitScriptRequest request;
        try {
            request = await BuildRequestAsync(options, cancellationToken);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        ExecuteRevitScriptData result;
        try {
            result = await SendRequestAsync(request, cancellationToken);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Failed to execute script: {ex.Message}");
            return 10;
        }

        if (!string.IsNullOrEmpty(result.Output))
            Console.Out.Write(result.Output);

        foreach (var diagnostic in result.Diagnostics) {
            var sourceSuffix = string.IsNullOrWhiteSpace(diagnostic.Source) ? string.Empty : $" ({diagnostic.Source})";
            Console.Error.WriteLine($"[{diagnostic.Severity}] {diagnostic.Stage}{sourceSuffix}: {diagnostic.Message}");
        }

        if (result.Status != ScriptExecutionStatus.Succeeded) {
            Console.Error.WriteLine(
                $"Execution {result.ExecutionId} finished with status {result.Status}."
            );
        }

        return MapExitCode(result.Status);
    }

    private static async Task<ExecuteRevitScriptRequest> BuildRequestAsync(
        CliOptions options,
        CancellationToken cancellationToken
    ) {
        var projectContent = ReadWorkspaceProjectContent(options.WorkspaceKey);
        if (options.UseStdin) {
            var scriptContent = await Console.In.ReadToEndAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(scriptContent))
                throw new InvalidOperationException("No script content was received on stdin.");

            return new ExecuteRevitScriptRequest(
                SourceKind: ScriptExecutionSourceKind.InlineSnippet,
                ScriptContent: scriptContent,
                WorkspaceKey: options.WorkspaceKey,
                ProjectContent: projectContent,
                SourceName: string.IsNullOrWhiteSpace(options.SourceName) ? "Script.cs" : options.SourceName
            );
        }

        return new ExecuteRevitScriptRequest(
            SourceKind: ScriptExecutionSourceKind.WorkspacePath,
            SourcePath: options.WorkspaceRelativePath,
            WorkspaceKey: options.WorkspaceKey,
            ProjectContent: projectContent
        );
    }

    private static async Task<ExecuteRevitScriptData> SendRequestAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken
    ) {
        using var httpClient = new HttpClient {
            Timeout = Timeout.InfiniteTimeSpan
        };
        using var response = await httpClient.PostAsJsonAsync(
            GetHostBaseUrl().TrimEnd('/') + HttpRoutes.ScriptingExecute,
            request,
            JsonOptions,
            cancellationToken
        );

        if (!response.IsSuccessStatusCode) {
            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            var detail = TryReadProblemDetail(responseBody);
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(detail)
                    ? $"Host request failed with status {(int)response.StatusCode} ({response.ReasonPhrase})."
                    : detail
            );
        }

        return await response.Content.ReadFromJsonAsync<ExecuteRevitScriptData>(JsonOptions, cancellationToken)
               ?? throw new InvalidOperationException("Host returned no execution result.");
    }

    private static int MapExitCode(ScriptExecutionStatus status) => status switch {
        ScriptExecutionStatus.Succeeded => 0,
        ScriptExecutionStatus.Rejected => 2,
        ScriptExecutionStatus.ReferenceResolutionFailed => 3,
        ScriptExecutionStatus.CompilationFailed => 4,
        ScriptExecutionStatus.RuntimeFailed => 5,
        _ => 10
    };

    private static string? ReadWorkspaceProjectContent(string workspaceKey) {
        var projectPath = Path.Combine(CliOptions.GetWorkspaceRoot(workspaceKey), "PeScripts.csproj");
        return File.Exists(projectPath) ? File.ReadAllText(projectPath) : null;
    }

    private static string GetHostBaseUrl() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostBaseUrlVariable);
        return string.IsNullOrWhiteSpace(configuredValue)
            ? SettingsEditorRuntime.DefaultHostBaseUrl
            : configuredValue;
    }

    private static string? TryReadProblemDetail(string responseBody) {
        if (string.IsNullOrWhiteSpace(responseBody))
            return null;

        try {
            return JsonSerializer.Deserialize<ProblemDetailsPayload>(responseBody, JsonOptions)?.Detail;
        } catch {
            return null;
        }
    }

    internal static ScriptFileCreationResult CreateWorkspaceScriptFile(
        string workspaceRoot,
        string relativePath,
        bool overwriteExisting
    ) {
        try {
            var normalizedRelativePath = CliOptions.NormalizeCreatePath(relativePath);
            var fullPath = CliOptions.ResolveWorkspaceFilePath(workspaceRoot, normalizedRelativePath);
            if (Directory.Exists(fullPath))
                return ScriptFileCreationResult.Failure($"Workspace path must point to a .cs file, not a directory: {normalizedRelativePath}");

            if (File.Exists(fullPath) && !overwriteExisting)
                return ScriptFileCreationResult.Failure($"Workspace script already exists: {fullPath}");

            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            File.WriteAllText(
                fullPath,
                CreateNewScriptTemplate(
                    Path.GetFileNameWithoutExtension(fullPath),
                    normalizedRelativePath.Replace(Path.DirectorySeparatorChar, '\\')
                )
            );

            var projectPath = Path.Combine(workspaceRoot, "PeScripts.csproj");
            var warningMessage = File.Exists(projectPath)
                ? null
                : $"Workspace project was not found at {projectPath}. Bootstrap the workspace from Revit if you need the generated project and guidance files.";

            return ScriptFileCreationResult.SuccessResult(
                $"Created script: {fullPath}",
                warningMessage
            );
        } catch (Exception ex) {
            return ScriptFileCreationResult.Failure(ex.Message);
        }
    }

    private static string CreateNewScriptTemplate(string fileStem, string workspaceRelativePath) {
        var containerName = SanitizeContainerTypeName(fileStem);
        return $$"""
            // Run from this workspace root:
            // pe-script {{workspaceRelativePath}}
            //
            // IntelliSense tip:
            // Define exactly one non-abstract PeScriptContainer per execute request.
            // That container is the entry point the script runner discovers and executes.

            public sealed class {{containerName}} : PeScriptContainer
            {
                public override void Execute()
                {
                    if (doc == null)
                    {
                        WriteLine("No active document.");
                        return;
                    }

                    WriteLine($"Active document: {doc.Title}");
                }
            }
            """;
    }

    private static string SanitizeContainerTypeName(string fileStem) {
        var builder = new StringBuilder();
        foreach (var ch in fileStem) {
            if (char.IsLetterOrDigit(ch) || ch == '_')
                builder.Append(ch);
        }

        if (builder.Length == 0)
            builder.Append("Script");

        if (!char.IsLetter(builder[0]) && builder[0] != '_')
            builder.Insert(0, "Script");

        return builder.ToString();
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}

internal sealed record CliOptions(
    CliCommandKind CommandKind,
    string WorkspaceKey,
    string? WorkspaceRelativePath,
    bool UseStdin,
    string? SourceName
) {
    public const string UsageText = """
        Usage:
          pe-script new <script-name-or-workspace-path>
          pe-script <workspace-relative-script.cs>
          pe-script --workspace <key> --path <workspace-relative-script.cs>
          pe-script --stdin --name <fileName>
        """;

    public static CliParseResult Parse(IReadOnlyList<string> args) {
        string workspaceKey = "default";
        string? workspaceRelativePath = null;
        bool useStdin = false;
        string? sourceName = null;
        var commandKind = CliCommandKind.Execute;
        string? positionalPath = null;

        for (var i = 0; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--help":
            case "-h":
                return CliParseResult.Usage();
            case "--workspace":
                workspaceKey = RequireValue(args, ref i, arg);
                break;
            case "--path":
                workspaceRelativePath = RequireValue(args, ref i, arg);
                break;
            case "--stdin":
                useStdin = true;
                break;
            case "--name":
                sourceName = RequireValue(args, ref i, arg);
                break;
            default:
                if (string.Equals(arg, "new", StringComparison.OrdinalIgnoreCase) && commandKind == CliCommandKind.Execute) {
                    commandKind = CliCommandKind.CreateNewFile;
                    break;
                }

                if (arg.StartsWith("--", StringComparison.Ordinal))
                    return CliParseResult.Failure($"Unknown argument '{arg}'.", showUsage: true);
                if (positionalPath != null)
                    return CliParseResult.Failure("Only one positional workspace path may be provided.", showUsage: true);

                positionalPath = arg;
                break;
            }
        }

        if (commandKind == CliCommandKind.CreateNewFile) {
            if (useStdin)
                return CliParseResult.Failure("Do not combine 'new' with --stdin.", showUsage: true);

            workspaceRelativePath ??= positionalPath;
            if (string.IsNullOrWhiteSpace(workspaceRelativePath))
                return CliParseResult.Failure("A script name or workspace-relative path is required for 'new'.", showUsage: true);

            workspaceRelativePath = NormalizeCreatePath(workspaceRelativePath);
            var validationError = ValidateCreatableWorkspacePath(workspaceKey, workspaceRelativePath);
            if (validationError != null)
                return CliParseResult.Failure(validationError, showUsage: false);

            return CliParseResult.SuccessResult(
                new CliOptions(
                    commandKind,
                    workspaceKey,
                    workspaceRelativePath,
                    useStdin,
                    sourceName
                )
            );
        }

        if (useStdin) {
            if (!string.IsNullOrWhiteSpace(workspaceRelativePath) || !string.IsNullOrWhiteSpace(positionalPath))
                return CliParseResult.Failure("Do not combine --stdin with a workspace path.", showUsage: true);
        } else {
            workspaceRelativePath ??= positionalPath;
            if (string.IsNullOrWhiteSpace(workspaceRelativePath))
                return CliParseResult.Failure("A workspace-relative .cs path or --stdin is required.", showUsage: true);

            if (Path.IsPathRooted(workspaceRelativePath))
                return CliParseResult.Failure("Only workspace-relative script paths are supported in this slice.", showUsage: true);

            if (!workspaceRelativePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                return CliParseResult.Failure("Workspace path must point to a .cs file.", showUsage: true);

            var validationError = ValidateWorkspacePath(workspaceKey, workspaceRelativePath);
            if (validationError != null)
                return CliParseResult.Failure(validationError, showUsage: false);
        }

        return CliParseResult.SuccessResult(
            new CliOptions(
                commandKind,
                workspaceKey,
                workspaceRelativePath,
                useStdin,
                sourceName
            )
        );
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }

    private static string? ValidateWorkspacePath(string workspaceKey, string relativePath) {
        try {
            var workspaceRoot = GetWorkspaceRoot(workspaceKey);
            var fullPath = ResolveWorkspaceFilePath(workspaceRoot, relativePath);
            if (Directory.Exists(fullPath))
                return $"Workspace path must point to a .cs file, not a directory: {relativePath}";
            if (!File.Exists(fullPath))
                return $"Workspace script was not found: {fullPath}";
            return null;
        } catch (Exception ex) {
            return ex.Message;
        }
    }

    internal static string? ValidateCreatableWorkspacePath(string workspaceKey, string relativePath) {
        try {
            var workspaceRoot = GetWorkspaceRoot(workspaceKey);
            var fullPath = ResolveWorkspaceFilePath(workspaceRoot, relativePath);
            if (Directory.Exists(fullPath))
                return $"Workspace path must point to a .cs file, not a directory: {relativePath}";
            return null;
        } catch (Exception ex) {
            return ex.Message;
        }
    }

    internal static string NormalizeCreatePath(string relativePath) {
        var normalizedPath = relativePath.Trim();
        if (string.IsNullOrWhiteSpace(normalizedPath))
            throw new ArgumentException("Workspace source path is required.", nameof(relativePath));

        if (!normalizedPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            normalizedPath += ".cs";

        if (!normalizedPath.Contains(Path.DirectorySeparatorChar) && !normalizedPath.Contains(Path.AltDirectorySeparatorChar))
            normalizedPath = Path.Combine("src", normalizedPath);

        return normalizedPath;
    }

    internal static string GetWorkspaceRoot(string workspaceKey) =>
        ScriptingWorkspaceLocations.ResolveWorkspaceRoot(workspaceKey);

    internal static string ResolveWorkspaceFilePath(string workspaceRoot, string relativePath) {
        var resolvedWorkspaceRoot = Path.GetFullPath(workspaceRoot);
        var fullPath = Path.GetFullPath(Path.Combine(resolvedWorkspaceRoot, relativePath));
        var workspaceRootWithSeparator = EnsureTrailingSeparator(resolvedWorkspaceRoot);
        if (!fullPath.StartsWith(workspaceRootWithSeparator, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException($"Workspace path escapes the workspace root: {relativePath}", nameof(relativePath));
        if (!fullPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Workspace path must point to a .cs file.", nameof(relativePath));

        return fullPath;
    }

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
}

internal readonly record struct CliParseResult(
    bool Success,
    CliOptions? Options,
    string? ErrorMessage,
    bool ShowUsage
) {
    public static CliParseResult SuccessResult(CliOptions options) => new(true, options, null, false);
    public static CliParseResult Failure(string errorMessage, bool showUsage) => new(false, null, errorMessage, showUsage);
    public static CliParseResult Usage() => new(false, null, null, true);
}

internal enum CliCommandKind {
    Execute,
    CreateNewFile
}

internal readonly record struct ScriptFileCreationResult(
    bool Success,
    string Message,
    string? WarningMessage
) {
    public static ScriptFileCreationResult SuccessResult(string message, string? warningMessage) =>
        new(true, message, warningMessage);

    public static ScriptFileCreationResult Failure(string message) =>
        new(false, message, null);
}

internal sealed record ProblemDetailsPayload(
    string? Detail
);
