namespace Pe.Shared.Product;

public sealed record PeaPayloadManifest(
    int SchemaVersion,
    string ProductName,
    string PayloadName,
    string Version,
    string ArchiveFileName,
    string Sha256,
    long SizeBytes,
    string CreatedUtc,
    string? CommitSha
) {
    public static PeaPayloadManifest Create(
        string version,
        string archiveFileName,
        string sha256,
        long sizeBytes,
        string createdUtc,
        string? commitSha
    ) =>
        new(
            PeaCliIdentity.PayloadManifestSchemaVersion,
            ProductIdentity.ProductName,
            PeaCliIdentity.DirectoryName,
            PeaCliIdentity.NormalizePayloadVersion(version),
            archiveFileName,
            sha256,
            sizeBytes,
            createdUtc,
            string.IsNullOrWhiteSpace(commitSha) ? null : commitSha
        );
}
