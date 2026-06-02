namespace Pe.Shared.Product;

public sealed record InstallerPayloadManifest(
    int SchemaVersion,
    string ProductName,
    string Version,
    string OutputDirectory,
    string RuntimePublishDirectory,
    string PeaBootstrapDirectory,
    string PeaPayloadArchivePath,
    string PeaPayloadManifestPath,
    string[] RevitPublishDirectories
) {
    public const int CurrentSchemaVersion = 3;

    public static InstallerPayloadManifest Create(
        string version,
        string outputDirectory,
        string runtimePublishDirectory,
        string peaBootstrapDirectory,
        string peaPayloadArchivePath,
        string peaPayloadManifestPath,
        IReadOnlyCollection<string> revitPublishDirectories
    ) =>
        new(
            CurrentSchemaVersion,
            ProductIdentity.ProductName,
            version,
            Path.GetFullPath(outputDirectory),
            Path.GetFullPath(runtimePublishDirectory),
            Path.GetFullPath(peaBootstrapDirectory),
            Path.GetFullPath(peaPayloadArchivePath),
            Path.GetFullPath(peaPayloadManifestPath),
            revitPublishDirectories.Select(Path.GetFullPath).ToArray()
        );

    public static string CreateFileName(string version) =>
        $"{ProductIdentity.ProductName}.installer-payload.{SanitizeFileNameSegment(version)}.json";

    private static string SanitizeFileNameSegment(string value) {
        var invalidCharacters = Path.GetInvalidFileNameChars();
        var characters = value.Select(character => invalidCharacters.Contains(character) ? '-' : character).ToArray();
        return new string(characters);
    }
}
