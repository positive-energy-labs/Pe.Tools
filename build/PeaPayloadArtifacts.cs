namespace Build;

public sealed record PeaPayloadArtifacts(
    string Version,
    ModularPipelines.FileSystem.Folder BootstrapDirectory,
    ModularPipelines.FileSystem.File ArchiveFile,
    ModularPipelines.FileSystem.File ManifestFile
);
