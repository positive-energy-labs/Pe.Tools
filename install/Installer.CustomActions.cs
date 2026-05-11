using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Pe.Shared.Product;
using WixToolset.Dtf.WindowsInstaller;

namespace Installer;

public static class CustomActions {
    [CustomAction]
    public static ActionResult InstallPeaPayload(Session session) {
        try {
            var peaRoot = RequireInstallPeaPath(session);
            var packagesRoot = Path.Combine(peaRoot, PeaCliIdentity.PackagesDirectoryName);
            var manifestPath = Directory.EnumerateFiles(packagesRoot, "*.json", SearchOption.TopDirectoryOnly)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .LastOrDefault();
            if (manifestPath is null)
                throw new InvalidOperationException($"No pea payload manifest was installed under {packagesRoot}.");

            var manifest = ReadManifest(manifestPath);

            if (manifest.SchemaVersion != PeaCliIdentity.PayloadManifestSchemaVersion)
                throw new InvalidOperationException(
                    $"Unsupported pea payload manifest schema {manifest.SchemaVersion}.");

            var archivePath = Path.Combine(packagesRoot, manifest.ArchiveFileName);
            if (!File.Exists(archivePath))
                throw new FileNotFoundException("Pea payload archive was not installed.", archivePath);

            var actualSha256 = ComputeSha256(archivePath);
            if (!actualSha256.Equals(manifest.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Pea payload hash mismatch. Expected {manifest.Sha256}; actual {actualSha256}.");

            var versionsRoot = Path.Combine(peaRoot, PeaCliIdentity.VersionsDirectoryName);
            var versionRoot = Path.Combine(versionsRoot, PeaCliIdentity.NormalizePayloadVersion(manifest.Version));
            Directory.CreateDirectory(versionsRoot);
            if (Directory.Exists(versionRoot))
                Directory.Delete(versionRoot, true);

            try {
                ZipFile.ExtractToDirectory(archivePath, versionRoot);
                File.Copy(manifestPath, Path.Combine(versionRoot, PeaCliIdentity.PayloadManifestFileName), true);
            } catch {
                if (Directory.Exists(versionRoot))
                    Directory.Delete(versionRoot, true);
                throw;
            }

            var currentPath = Path.Combine(peaRoot, PeaCliIdentity.CurrentVersionFileName);
            var currentTempPath = $"{currentPath}.tmp";
            File.WriteAllText(currentTempPath, manifest.Version);
            if (File.Exists(currentPath))
                File.Replace(currentTempPath, currentPath, null);
            else
                File.Move(currentTempPath, currentPath);

            session.Log($"Installed pea payload {manifest.Version} to {versionRoot}.");
            return ActionResult.Success;
        } catch (Exception ex) {
            session.Log($"Failed to install pea payload: {ex}");
            return ActionResult.Failure;
        }
    }

    [CustomAction]
    public static ActionResult RemovePeaPayloadVersions(Session session) {
        try {
            var peaRoot = RequireInstallPeaPath(session);
            DeleteIfExists(Path.Combine(peaRoot, PeaCliIdentity.VersionsDirectoryName));
            DeleteIfExists(Path.Combine(peaRoot, PeaCliIdentity.PackagesDirectoryName));
            var currentPath = Path.Combine(peaRoot, PeaCliIdentity.CurrentVersionFileName);
            if (File.Exists(currentPath))
                File.Delete(currentPath);

            session.Log($"Removed pea payload versions under {peaRoot}.");
            return ActionResult.Success;
        } catch (Exception ex) {
            session.Log($"Failed to remove pea payload versions: {ex}");
            return ActionResult.Failure;
        }
    }

    private static string RequireInstallPeaPath(Session session) {
        var path = session.CustomActionData.TryGetValue("INSTALLPEA", out var deferredPath)
            ? deferredPath
            : session["INSTALLPEA"];
        if (string.IsNullOrWhiteSpace(path))
            throw new InvalidOperationException("INSTALLPEA was not resolved.");

        return Path.GetFullPath(path);
    }

    private static PeaPayloadManifest ReadManifest(string manifestPath) {
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;
        return new PeaPayloadManifest(
            GetRequiredInt(root, "schemaVersion"),
            GetRequiredString(root, "productName"),
            GetRequiredString(root, "payloadName"),
            GetRequiredString(root, "version"),
            GetRequiredString(root, "archiveFileName"),
            GetRequiredString(root, "sha256"),
            GetRequiredLong(root, "sizeBytes"),
            GetRequiredString(root, "createdUtc"),
            GetOptionalString(root, "commitSha")
        );
    }

    private static string GetRequiredString(JsonElement root, string propertyName) {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Pea payload manifest is missing string property '{propertyName}'.");

        return property.GetString()!;
    }

    private static int GetRequiredInt(JsonElement root, string propertyName) {
        if (!root.TryGetProperty(propertyName, out var property) || !property.TryGetInt32(out var value))
            throw new InvalidOperationException($"Pea payload manifest is missing integer property '{propertyName}'.");

        return value;
    }

    private static long GetRequiredLong(JsonElement root, string propertyName) {
        if (!root.TryGetProperty(propertyName, out var property) || !property.TryGetInt64(out var value))
            throw new InvalidOperationException($"Pea payload manifest is missing integer property '{propertyName}'.");

        return value;
    }

    private static string? GetOptionalString(JsonElement root, string propertyName) {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind == JsonValueKind.Null)
            return null;

        if (property.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Pea payload manifest property '{propertyName}' must be a string.");

        return property.GetString();
    }

    private static void DeleteIfExists(string path) {
        if (Directory.Exists(path))
            Directory.Delete(path, true);
    }

    private static string ComputeSha256(string path) {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
