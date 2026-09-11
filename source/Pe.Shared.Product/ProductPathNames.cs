namespace Pe.Shared.Product;

/// <summary>
///     Names of product-owned directories and files: mutable state, user content, and logs.
///     Installed-binary names (bin, shims, dev, host, pea) belong to
///     <c>product.payloads.json</c> and are not restated here.
/// </summary>
public static class ProductPathNames {
    public const string StateDirectoryName = "state";
    public const string LogsDirectoryName = "logs";
    public const string CacheDirectoryName = "cache";
    public const string SettingsDirectoryName = "settings";
    public const string WorkspacesDirectoryName = "workspaces";
    public const string InlineScriptsDirectoryName = "inline-scripts";
    public const string OutputDirectoryName = "output";
    public const string GlobalDirectoryName = "Global";
    public const string AgentInstructionsFileName = "AGENTS.md";
    public const string ReadmeFileName = "README.md";
    public const string PodManifestFileName = "pod.json";
    public const string HostLogFileName = "host.log.txt";
    public const string RevitAppLogFileName = "revit.log.txt";
}
