using Pe.Shared.HostContracts.Scripting;

namespace Pe.Dev.Cli;

internal sealed record ScriptCliOptions(
    ScriptCliCommandKind CommandKind,
    string WorkspaceKey,
    string? WorkspaceRelativePath,
    bool UseStdin,
    string? SourceName
) {
    public const string UsageText = """
                                    Usage:
                                      pe-dev revit script new <script-name-or-workspace-path>
                                      pe-dev revit script <workspace-relative-script.cs>
                                      pe-dev revit script --workspace <key> --path <workspace-relative-script.cs>
                                      pe-dev revit script --stdin --name <fileName>
                                    """;

    public static ScriptCliParseResult Parse(IReadOnlyList<string> args) {
        var workspaceKey = "default";
        string? workspaceRelativePath = null;
        var useStdin = false;
        string? sourceName = null;
        var commandKind = ScriptCliCommandKind.Execute;
        string? positionalPath = null;

        for (var i = 0; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--help":
            case "-h":
                return ScriptCliParseResult.Usage();
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
                if (string.Equals(arg, "new", StringComparison.OrdinalIgnoreCase) &&
                    commandKind == ScriptCliCommandKind.Execute) {
                    commandKind = ScriptCliCommandKind.CreateNewFile;
                    break;
                }

                if (arg.StartsWith("--", StringComparison.Ordinal))
                    return ScriptCliParseResult.Failure($"Unknown argument '{arg}'.", true);
                if (positionalPath != null)
                    return ScriptCliParseResult.Failure("Only one positional workspace path may be provided.", true);

                positionalPath = arg;
                break;
            }
        }

        if (commandKind == ScriptCliCommandKind.CreateNewFile) {
            if (useStdin)
                return ScriptCliParseResult.Failure("Do not combine 'new' with --stdin.", true);

            workspaceRelativePath ??= positionalPath;
            if (string.IsNullOrWhiteSpace(workspaceRelativePath))
                return ScriptCliParseResult.Failure("A script name or workspace-relative path is required for 'new'.",
                    true);

            workspaceRelativePath = NormalizeCreatePath(workspaceRelativePath);
            var validationError = ValidateCreatableWorkspacePath(workspaceKey, workspaceRelativePath);
            if (validationError != null)
                return ScriptCliParseResult.Failure(validationError, false);

            return ScriptCliParseResult.SuccessResult(
                new ScriptCliOptions(
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
                return ScriptCliParseResult.Failure("Do not combine --stdin with a workspace path.", true);
        } else {
            workspaceRelativePath ??= positionalPath;
            if (string.IsNullOrWhiteSpace(workspaceRelativePath))
                return ScriptCliParseResult.Failure("A workspace-relative .cs path or --stdin is required.", true);

            if (Path.IsPathRooted(workspaceRelativePath))
                return ScriptCliParseResult.Failure("Only workspace-relative script paths are supported in this slice.",
                    true);

            if (!workspaceRelativePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                return ScriptCliParseResult.Failure("Workspace path must point to a .cs file.", true);

            var validationError = ValidateWorkspacePath(workspaceKey, workspaceRelativePath);
            if (validationError != null)
                return ScriptCliParseResult.Failure(validationError, false);
        }

        return ScriptCliParseResult.SuccessResult(
            new ScriptCliOptions(
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

        if (!normalizedPath.Contains(Path.DirectorySeparatorChar) &&
            !normalizedPath.Contains(Path.AltDirectorySeparatorChar))
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
            throw new ArgumentException($"Workspace path escapes the workspace root: {relativePath}",
                nameof(relativePath));
        if (!fullPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Workspace path must point to a .cs file.", nameof(relativePath));

        return fullPath;
    }

    private static string EnsureTrailingSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
}

internal readonly record struct ScriptCliParseResult(
    bool Success,
    ScriptCliOptions? Options,
    string? ErrorMessage,
    bool ShowUsage
) {
    public static ScriptCliParseResult SuccessResult(ScriptCliOptions options) => new(true, options, null, false);

    public static ScriptCliParseResult Failure(string errorMessage, bool showUsage) =>
        new(false, null, errorMessage, showUsage);

    public static ScriptCliParseResult Usage() => new(false, null, null, true);
}

internal enum ScriptCliCommandKind {
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
