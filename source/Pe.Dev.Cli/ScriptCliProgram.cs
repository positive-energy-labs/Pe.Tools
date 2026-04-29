using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Dev.Cli;

internal static class ScriptCliProgram {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static async Task<int> RunAsync(
        string[] args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        ScriptCliParseResult parseResult;
        try {
            parseResult = ScriptCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine(ScriptCliOptions.UsageText);
            return 10;
        }

        if (!parseResult.Success || parseResult.Options == null) {
            if (!string.IsNullOrWhiteSpace(parseResult.ErrorMessage))
                Console.Error.WriteLine(parseResult.ErrorMessage);

            if (parseResult.ShowUsage)
                Console.Error.WriteLine(ScriptCliOptions.UsageText);

            return parseResult.ShowUsage && string.IsNullOrWhiteSpace(parseResult.ErrorMessage) ? 0 : 10;
        }

        var options = parseResult.Options;
        if (options.CommandKind == ScriptCliCommandKind.CreateNewFile) {
            var createResult = CreateWorkspaceScriptFile(
                ScriptCliOptions.GetWorkspaceRoot(options.WorkspaceKey),
                options.WorkspaceRelativePath ?? throw new InvalidOperationException("Workspace path is required."),
                false
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
            var sourceSuffix = string.IsNullOrWhiteSpace(diagnostic.Source)
                ? string.Empty
                : $" ({diagnostic.Source})";
            Console.Error.WriteLine(
                $"[{diagnostic.Severity}] {diagnostic.Stage}{sourceSuffix}: {diagnostic.Message}");
        }

        if (result.Status != ScriptExecutionStatus.Succeeded) {
            Console.Error.WriteLine(
                $"Execution {result.ExecutionId} finished with status {result.Status}."
            );
        }

        return MapExitCode(result.Status);
    }

    private static async Task<ExecuteRevitScriptRequest> BuildRequestAsync(
        ScriptCliOptions options,
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
        using var httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
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
        var projectPath = Path.Combine(ScriptCliOptions.GetWorkspaceRoot(workspaceKey), "PeScripts.csproj");
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
            var normalizedRelativePath = ScriptCliOptions.NormalizeCreatePath(relativePath);
            var fullPath = ScriptCliOptions.ResolveWorkspaceFilePath(workspaceRoot, normalizedRelativePath);
            if (Directory.Exists(fullPath))
                return ScriptFileCreationResult.Failure(
                    $"Workspace path must point to a .cs file, not a directory: {normalizedRelativePath}");

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
                 // pe-dev revit script {{workspaceRelativePath}}
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
