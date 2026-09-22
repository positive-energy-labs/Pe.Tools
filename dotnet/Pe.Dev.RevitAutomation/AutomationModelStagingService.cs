using Pe.Aps.DataManagement;
using Pe.Aps.Core;
using Pe.Aps.DesignAutomation;
using System.IO;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationModelStagingService {
    private static readonly byte[] ZipHeader = [0x50, 0x4B, 0x03, 0x04];

    public async Task<AutomationModelStagingResult> StageLocalModelAsync(
        string repoRoot,
        ModelResolutionResult resolvedModel,
        string bucketKey,
        string runId,
        string artifactAccessToken,
        DataManagementApiClient dataManagementClient,
        ObjectStorageApiClient objectStorageClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (string.IsNullOrWhiteSpace(resolvedModel.ProjectId) || string.IsNullOrWhiteSpace(resolvedModel.VersionId)) {
            return new AutomationModelStagingResult {
                StagedInputKind = AutomationStagedInputKind.UnsupportedPackage,
                FailureMessage =
                    $"Resolved model '{resolvedModel.ModelPath}' did not include ProjectId/VersionId required for transient local staging."
            };
        }

        var version = await dataManagementClient.GetVersionAsync(
                resolvedModel.ProjectId,
                resolvedModel.VersionId,
                cancellationToken
            )
            .ConfigureAwait(false);

        var fileName = BuildFileName(version, resolvedModel);
        var paths = new AutomationStatePaths(repoRoot);
        var stagingDirectory = Path.Combine(paths.StagingInputsRoot, runId);
        var localPath = Path.Combine(stagingDirectory, fileName);
        Directory.CreateDirectory(stagingDirectory);

        try {
            log?.Invoke($"Staging: downloading source model for {resolvedModel.ModelPath}");
            await dataManagementClient.DownloadVersionSourceAsync(
                    resolvedModel.ProjectId,
                    resolvedModel.VersionId,
                    localPath,
                    cancellationToken
                )
                .ConfigureAwait(false);

            var stagedInputKind = await DetectStagedInputKindAsync(localPath, version, cancellationToken)
                .ConfigureAwait(false);
            if (stagedInputKind != AutomationStagedInputKind.Rvt) {
                return new AutomationModelStagingResult {
                    StagedInputKind = stagedInputKind,
                    FailureMessage =
                        $"Downloaded source for '{resolvedModel.ModelPath}' is not a single RVT file. MVP transient-local staging does not support ZIP/composite packages."
                };
            }

            var objectKey = BuildStagedInputObjectKey(resolvedModel, runId, fileName);
            log?.Invoke($"Staging: uploading transient source model {fileName}");
            await objectStorageClient.UploadObjectAsync(bucketKey, objectKey, localPath, cancellationToken)
                .ConfigureAwait(false);

            return new AutomationModelStagingResult {
                StagedInputKind = AutomationStagedInputKind.Rvt,
                InputArgument = DesignAutomationWorkItemArguments.BuildObjectGetArgument(
                    bucketKey,
                    objectKey,
                    artifactAccessToken
                )
            };
        } finally {
            if (Directory.Exists(stagingDirectory))
                Directory.Delete(stagingDirectory, true);
        }
    }

    private static string BuildFileName(DataManagementVersionEntry version, ModelResolutionResult resolvedModel) {
        var rawName = string.IsNullOrWhiteSpace(version.DisplayName)
            ? $"{resolvedModel.ModelTitle}.rvt"
            : version.DisplayName.Trim();
        if (rawName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) {
            rawName = new string(rawName.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '-' : ch).ToArray());
        }

        return string.IsNullOrWhiteSpace(Path.GetExtension(rawName)) ? rawName + ".rvt" : rawName;
    }

    internal static async Task<AutomationStagedInputKind> DetectStagedInputKindAsync(
        string localPath,
        DataManagementVersionEntry version,
        CancellationToken cancellationToken
    ) {
        await using var stream = File.OpenRead(localPath);
        var buffer = new byte[ZipHeader.Length];
        var bytesRead = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        if (bytesRead == ZipHeader.Length && buffer.SequenceEqual(ZipHeader))
            return AutomationStagedInputKind.UnsupportedPackage;

        return string.Equals(Path.GetExtension(localPath), ".rvt", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(version.FileType, "rvt", StringComparison.OrdinalIgnoreCase)
            ? AutomationStagedInputKind.Rvt
            : AutomationStagedInputKind.UnsupportedPackage;
    }

    private static string BuildStagedInputObjectKey(
        ModelResolutionResult resolvedModel,
        string runId,
        string fileName
    ) =>
        $"schedule-inputs/{DateTime.UtcNow:yyyy/MM/dd}/{resolvedModel.Region.Trim().ToUpperInvariant()}/" +
        $"{resolvedModel.ProjectGuid.Trim().ToLowerInvariant()}/{resolvedModel.ModelGuid.Trim().ToLowerInvariant()}/" +
        $"{runId}/{fileName}";
}

internal sealed class AutomationModelStagingResult {
    public AutomationStagedInputKind StagedInputKind { get; init; }
    public IReadOnlyDictionary<string, object>? InputArgument { get; init; }
    public string? FailureMessage { get; init; }
}

