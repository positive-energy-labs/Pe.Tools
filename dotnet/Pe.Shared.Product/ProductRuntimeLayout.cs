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
        "The shell did not configure the product runtime. Pe.App, Pe.Host.Tray and Pe.Dev.Cli call ProductRuntimeLayout.Configure once at startup.");

    /// <summary>Set once by the shell from the facts it was told; a second call is a startup bug.</summary>
    public static ProductRuntimeLayout Configure(ProductLane lane, string ownerRoot) {
        var layout = For(lane, ownerRoot, Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable));
        if (Interlocked.CompareExchange(ref _current, layout, null) is not null)
            throw new InvalidOperationException("The product runtime is already configured for this process.");
        return layout;
    }

    /// <summary>Pure: <paramref name="ownerRoot" /> is the dev checkout or the SDK install root.</summary>
    public static ProductRuntimeLayout For(ProductLane lane, string ownerRoot, string? productHome) {
        // v0.7.30 refused an installed payload under a home override (its root check failed); kept unchanged.
        if (lane == ProductLane.Installed && !string.IsNullOrWhiteSpace(productHome))
            throw new InvalidOperationException($"An installed runtime does not run under {ProductPathNames.ProductHomeVariable}; unset it, or use a dev session.");
        var root = ProductPathing.StateRoot(lane, ownerRoot, productHome);
        // Only an override can aim dev state at the installed namespace; refuse it where the override is read.
        if (lane == ProductLane.Dev && (Path.GetFullPath(root) + Path.DirectorySeparatorChar).StartsWith(
                Path.GetFullPath(ProductPathing.InstalledNamespace) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Dev runtime cannot use installed product state '{root}'.");
        return new ProductRuntimeLayout(lane, ownerRoot, root);
    }

    /// <summary>The wire spelling every receipt, status and SDK call uses.</summary>
    public string LaneName => this.Lane == ProductLane.Dev ? "dev" : "installed";
    public string? SourceRoot => this.Lane == ProductLane.Dev ? this.OwnerRoot : null;
    public string? InstallRoot => this.Lane == ProductLane.Installed ? this.OwnerRoot : null;
    public string ScratchPath => Path.Combine(this.RootPath, "scratch");
    public ProductRuntimeStateLayout State => new(Path.Combine(this.RootPath, ProductPathNames.StateDirectoryName));
    public ProductRuntimeLogLayout Logs => new(Path.Combine(this.RootPath, ProductPathNames.LogsDirectoryName));
    public ProductRuntimeCacheLayout Cache => new(Path.Combine(this.RootPath, ProductPathNames.CacheDirectoryName));
}

public sealed record ProductRuntimeStateLayout(string RootPath) {
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
