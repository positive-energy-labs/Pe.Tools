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
    public const string PreferencesFileName = "preferences.json";
    public const string PodsDirectoryName = "Pods";
    public const string SettingsDirectoryName = "settings";
    public const string AssetsDirectoryName = "assets";
    public const string GlobalDirectoryName = "Global";
    /// <summary>The marker that proves a folder is a home; its one field is <c>tier</c>.</summary>
    public const string HomeMarkerFileName = "pe-home.json";
    /// <summary>A home's <c>Settings\&lt;owner&gt;.json</c> folder. A pod's own members folder is <see cref="SettingsDirectoryName" />.</summary>
    public const string HomeSettingsDirectoryName = "Settings";
    public const string KeysFileName = "keys.json";
    /// <summary>The firm home is <c>04 PE Software Files\Pe.Tools</c> on the shared drive, which Google Drive mounts under <c>Shared drives</c>.</summary>
    public const string FirmSoftwareDirectoryName = "04 PE Software Files";
    public const string SharedDrivesDirectoryName = "Shared drives";
    /// <summary>The <c>Runs</c> segment for a run no pod owns. A pod id is a slug and cannot start with an underscore.</summary>
    public const string PodlessRunsDirectoryName = "_no-pod";
    public const string AgentInstructionsFileName = "AGENTS.md";
    public const string ReadmeFileName = "README.md";
    public const string PodManifestFileName = "pod.json";
    public const string HostLogFileName = "host.log.txt";
    public const string RevitAppLogFileName = "revit.log.txt";

    /// <summary>The one override for the whole product home; host, Pea and Revit read it identically.</summary>
    public const string ProductHomeVariable = "PE_TOOLS_PRODUCT_HOME";
    /// <summary>Dev override only: names the firm home itself and skips the drive probe. Never a machine-state override.</summary>
    public const string SharedRootVariable = "PE_TOOLS_SHARED_ROOT";

    /// <summary>Under an override, machine-local state, logs and service files live in <c>&lt;home&gt;\.local-state</c>.</summary>
    public const string LocalStateDirectoryName = ".local-state";
}
