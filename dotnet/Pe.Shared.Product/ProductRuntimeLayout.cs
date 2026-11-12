namespace Pe.Shared.Product;

/// <summary>The lane a shell was told it runs in: by the Revit SDK, by its parent's argv, or by its operator.</summary>
public enum ProductLane { Dev, Installed }

/// <summary>
///     The per-user product root and the mutable state/log/cache trees the product owns underneath
///     it. Installed BINARY paths are deliberately absent: <c>product.payloads.json</c> is the
///     single authority for the installed layout, and the SDK's InstalledProduct reads it. Nothing
///     here restates payload names, executable names, or bin/shim directories.
/// </summary>
public sealed record ProductRuntimeLayout(ProductLane Lane, string OwnerRoot, string RootPath) {
    private static ProductRuntimeLayout? _current;

    /// <summary>The process's one runtime record. Unset means the shell skipped startup; nothing guesses.</summary>
    public static ProductRuntimeLayout Current => _current ?? throw new InvalidOperationException(
        "The shell did not configure the product runtime. Pe.App (also in Revit test runs, where the SDK boots it), Pe.Host.Tray, Pe.Dev.Cli and Pe.Rhvac.Tool call ProductRuntimeLayout.Configure once at startup.");

    /// <summary>Set once by the shell from the facts it was told; a second call is a startup bug.</summary>
    public static ProductRuntimeLayout Configure(ProductLane lane, string ownerRoot) {
        var layout = For(lane, ownerRoot, Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable));
        if (Interlocked.CompareExchange(ref _current, layout, null) is not null)
            throw new InvalidOperationException("The product runtime is already configured for this process.");
        return layout;
    }

    /// <summary>Resolve the told owner against this machine's content homes and installed namespace.</summary>
    public static ProductRuntimeLayout For(ProductLane lane, string ownerRoot, string? productHome) {
        // ponytail: the fence is the dev override only. A firm home found by the drive probe is not fenced,
        // because probing every drive at each shell's startup can block on a dead mapped drive. Fence the
        // probed home too if a checkout or install ever lands on the shared drive.
        var root = ProductPathing.StateRoot(lane, ownerRoot, productHome,
            Environment.GetEnvironmentVariable(ProductPathNames.SharedRootVariable), ProductPathing.DocumentsUserRoot);
        // Only an override can aim dev state at the installed namespace; refuse it where the override is read.
        if (lane == ProductLane.Dev && (Path.GetFullPath(root) + Path.DirectorySeparatorChar).StartsWith(
                Path.GetFullPath(ProductPathing.InstalledNamespace) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Dev runtime cannot use installed product state '{root}'.");
        return new ProductRuntimeLayout(lane, ownerRoot, root);
    }

    /// <summary>
    ///     The one owner argv grammar for child processes: a leading <c>--lane dev|installed --root &lt;absolute
    ///     checkout or install root&gt;</c>, then the launch arguments. Pure; the shell then calls Configure.
    /// </summary>
    public static (ProductLane Lane, string Root, string[] Launch) ParseOwnerArguments(string[] args) {
        if (args.Length < 4 || args[0] != "--lane" || args[2] != "--root" || !IsFullyQualified(args[3]))
            throw new ArgumentException("Expected --lane <dev|installed> --root <absolute owner root> before the launch arguments.");
        var lane = args[1] switch {
            "dev" => ProductLane.Dev,
            "installed" => ProductLane.Installed,
            _ => throw new ArgumentException($"Unknown lane '{args[1]}'.")
        };
        return (lane, args[3], args.Skip(4).ToArray());
    }

    // net48 has no Path.IsPathFullyQualified: a drive-qualified or UNC path.
    private static bool IsFullyQualified(string path) =>
        path.Length >= 3 && char.IsLetter(path[0]) && path[1] == ':' && (path[2] == '\\' || path[2] == '/')
        || path.StartsWith(@"\\", StringComparison.Ordinal);

    /// <summary>The wire spelling every receipt, status and SDK call uses.</summary>
    public string LaneName => this.Lane == ProductLane.Dev ? "dev" : "installed";
    public string? SourceRoot => this.Lane == ProductLane.Dev ? this.OwnerRoot : null;
    public string? InstallRoot => this.Lane == ProductLane.Installed ? this.OwnerRoot : null;
    public string ScratchPath => Path.Combine(this.RootPath, "scratch");
    public ProductRuntimeStateLayout State => new(Path.Combine(this.RootPath, ProductPathNames.StateDirectoryName));
    public ProductRuntimeLogLayout Logs => new(Path.Combine(this.RootPath, ProductPathNames.LogsDirectoryName));
    public ProductRuntimeCacheLayout Cache => new(Path.Combine(this.RootPath, ProductPathNames.CacheDirectoryName));
}

/// <summary>
///     <c>&lt;state root&gt;\state</c>. Everything a content home may not hold lives here (homes freeze shape 7),
///     under the one folder name an MSI upgrade keeps: Work, Page state, run output, the safety-net blobs, the T3
///     home and the agent's working directory. The shared fixture's <c>stateTree</c> rows pin these with TS.
/// </summary>
public sealed record ProductRuntimeStateLayout(string RootPath) {
    public string WorkPath => Path.Combine(this.RootPath, "Work");
    public string T3Path => Path.Combine(this.RootPath, "T3");
    /// <summary>The agent's working directory: its <c>AGENTS.md</c> and the harness projections.</summary>
    public string AgentPath => Path.Combine(this.RootPath, "Agent");
    public string AgentInstructionsPath => Path.Combine(this.AgentPath, ProductPathNames.AgentInstructionsFileName);
    public string RunsPath => Path.Combine(this.RootPath, "Runs");
    /// <summary>Where a run with no pod writes. Every child is one run folder: <c>_no-pod\&lt;run-id&gt;</c>.</summary>
    public string PodlessRunsPath => Path.Combine(this.RunsPath, ProductPathNames.PodlessRunsDirectoryName);
    /// <summary>Per-module task output, <c>_modules\&lt;module&gt;</c>: files a pod-less command writes, with no run id.</summary>
    public string ModuleOutputPath => Path.Combine(this.RunsPath, ProductPathNames.ModuleOutputDirectoryName);

    public string PageStatePath(string pageSlug) => Path.Combine(this.RootPath, "Pages", Segment(pageSlug, nameof(pageSlug)));

    /// <summary>One run's folder, keyed on the pod's manifest id (unique across homes); a null pod is a pod-less run.</summary>
    public string RunPath(string? podId, string runId) => Path.Combine(
        podId is null ? this.PodlessRunsPath : Path.Combine(this.RunsPath, PodSegment(podId)), Segment(runId, nameof(runId)));

    public string BlobPath(string sha256) => Path.Combine(this.RootPath, "Blobs", "sha256", Segment(sha256, nameof(sha256)));

    private static string PodSegment(string podId) => podId.StartsWith("_", StringComparison.Ordinal)
        ? throw new ArgumentException($"Pod id '{podId}' cannot start with an underscore; that prefix is reserved under Runs.", nameof(podId))
        : Segment(podId, nameof(podId));

    // An id becomes exactly one folder name, or the path would leave its parent.
    private static string Segment(string value, string paramName) =>
        string.IsNullOrWhiteSpace(value) || value is "." or ".." || value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        || value != value.Trim() || value.EndsWith(".", StringComparison.Ordinal)
            ? throw new ArgumentException($"'{value}' is not one folder name.", paramName)
            : value;

    public string GlobalStatePath => Path.Combine(this.RootPath, ProductPathNames.GlobalDirectoryName);
    public string ApsAuthStatePath => Path.Combine(this.RootPath, "aps-auth");
    public string ApsTokenStorePath => Path.Combine(this.ApsAuthStatePath, "tokens.json");
    public string ApsCredentialsPath => Path.Combine(this.ApsAuthStatePath, "credentials.json");

    public string ResolveModuleStatePath(string module) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, module, nameof(module));
}

public sealed record ProductRuntimeLogLayout(string RootPath) {
    public string HostLogPath => Path.Combine(this.RootPath, ProductPathNames.HostLogFileName);
    public string RevitAppLogPath => Path.Combine(this.RootPath, ProductPathNames.RevitAppLogFileName);
}

public sealed record ProductRuntimeCacheLayout(string RootPath) {
    public string ResolveModuleCachePath(string module) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, module, nameof(module));
}
