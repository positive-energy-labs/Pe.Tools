namespace Pe.Shared.Product;

public static class PeaCliIdentity {
    public const string DirectoryName = ProductPathNames.PeaDirectoryName;
    public const string LauncherName = "pea.cmd";
    public const string NodeExecutableName = "node.exe";
    public const string CurrentVersionFileName = "current.txt";
    public const string DevSourceFileName = "dev-source.txt";
    public const string VersionsDirectoryName = "versions";
    public const string PackagesDirectoryName = "packages";
    public const string PayloadManifestFileName = "pea-payload.json";
    public const int PayloadManifestSchemaVersion = 1;

    public static string CreatePayloadArchiveFileName(string version) =>
        $"Pe.Tools.pea.{NormalizePayloadVersion(version)}.zip";

    public static string CreatePayloadManifestFileName(string version) =>
        $"Pe.Tools.pea.{NormalizePayloadVersion(version)}.json";

    public static string NormalizePayloadVersion(string version) =>
        ProductPathing.NormalizeRelativePath(version, nameof(version));
}
