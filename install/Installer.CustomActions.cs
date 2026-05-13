using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Pe.Shared.Product;
using WixToolset.Dtf.WindowsInstaller;

namespace Installer;

public static class CustomActions {
    private static readonly string[] LegacyInstallNames = [
        "PE_Tools",
        "Pe.App",
        "PE Tools",
        "Pe.Tools",
        "Positive Energy"
    ];

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
    public static ActionResult RemoveLegacyBetaInstallPaths(Session session) {
        try {
            foreach (var root in ResolveLegacyApplicationPluginRoots())
                RemoveLegacyApplicationPluginDirectories(session, root);

            foreach (var addinsRoot in ResolveLegacyRevitAddinsRoots())
                RemoveLegacyRevitAddinPaths(session, addinsRoot);

            return ActionResult.Success;
        } catch (Exception ex) {
            session.Log($"Failed to remove legacy beta install paths: {ex}");
            return ActionResult.Success;
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

    [CustomAction]
    public static ActionResult RemoveInstalledRevitAddinPaths(Session session) {
        try {
            var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var addinsRoot = RevitDeploymentIdentity.ResolvePerUserAddinsRootPath(applicationData);
            if (!Directory.Exists(addinsRoot)) {
                session.Log($"Revit add-ins root does not exist: {addinsRoot}");
                return ActionResult.Success;
            }

            foreach (var yearDirectory in Directory.EnumerateDirectories(addinsRoot)
                         .Where(IsRevitYearDirectory)
                         .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
                RemoveInstalledRevitAddinPath(session, yearDirectory);
            }

            return ActionResult.Success;
        } catch (Exception ex) {
            session.Log($"Failed to remove installed Revit add-in paths: {ex}");
            return ActionResult.Success;
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

    private static IEnumerable<string> ResolveLegacyApplicationPluginRoots() {
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var commonApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);

        yield return Path.Combine(applicationData, RevitDeploymentIdentity.AutodeskDirectoryName, "ApplicationPlugins");
        yield return Path.Combine(commonApplicationData, RevitDeploymentIdentity.AutodeskDirectoryName, "ApplicationPlugins");
    }

    private static IEnumerable<string> ResolveLegacyRevitAddinsRoots() {
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var commonApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);

        yield return RevitDeploymentIdentity.ResolvePerUserAddinsRootPath(applicationData);
        yield return Path.Combine(
            commonApplicationData,
            RevitDeploymentIdentity.AutodeskDirectoryName,
            RevitDeploymentIdentity.RevitDirectoryName,
            RevitDeploymentIdentity.AddinsDirectoryName
        );
    }

    private static void RemoveLegacyApplicationPluginDirectories(Session session, string root) {
        if (!Directory.Exists(root)) {
            session.Log($"Legacy ApplicationPlugins root does not exist: {root}");
            return;
        }

        foreach (var directory in Directory.EnumerateDirectories(root)
                     .Where(path => IsLegacyInstallName(Path.GetFileName(path)))
                     .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            TryDeleteDirectory(session, directory);
        }
    }

    private static void RemoveLegacyRevitAddinPaths(Session session, string addinsRoot) {
        if (!Directory.Exists(addinsRoot)) {
            session.Log($"Legacy Revit add-ins root does not exist: {addinsRoot}");
            return;
        }

        foreach (var yearDirectory in Directory.EnumerateDirectories(addinsRoot)
                     .Where(IsRevitYearDirectory)
                     .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            RemoveLegacyRevitAddinYearPaths(session, yearDirectory);
        }
    }

    private static void RemoveLegacyRevitAddinYearPaths(Session session, string yearDirectory) {
        var currentShapeDirectory = Path.Combine(yearDirectory, RevitDeploymentIdentity.AddinAssemblyDirectoryName);
        var hasCurrentShape = IsCurrentRevitAddinShape(currentShapeDirectory);

        foreach (var directory in Directory.EnumerateDirectories(yearDirectory)
                     .Where(path => IsLegacyInstallName(Path.GetFileName(path)))
                     .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            if (hasCurrentShape && IsCurrentRevitAddinDirectory(directory)) {
                session.Log($"Skipping current Revit add-in directory shape: {directory}");
                continue;
            }

            TryDeleteDirectory(session, directory);
        }

        foreach (var addinFile in Directory.EnumerateFiles(yearDirectory, "*.addin", SearchOption.TopDirectoryOnly)
                     .Where(path => IsLegacyInstallName(Path.GetFileNameWithoutExtension(path)))
                     .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)) {
            if (hasCurrentShape && IsCurrentRevitAddinManifest(addinFile)) {
                session.Log($"Skipping current Revit add-in manifest shape: {addinFile}");
                continue;
            }

            TryDeleteFile(session, addinFile);
        }
    }

    private static bool IsLegacyInstallName(string name) =>
        LegacyInstallNames.Contains(name, StringComparer.OrdinalIgnoreCase);

    private static bool IsCurrentRevitAddinDirectory(string directory) =>
        string.Equals(
            Path.GetFileName(directory),
            RevitDeploymentIdentity.AddinAssemblyDirectoryName,
            StringComparison.OrdinalIgnoreCase
        );

    private static bool IsCurrentRevitAddinManifest(string path) =>
        string.Equals(
            Path.GetFileName(path),
            RevitDeploymentIdentity.AddinManifestFileName,
            StringComparison.OrdinalIgnoreCase
        );

    private static bool IsCurrentRevitAddinShape(string assemblyDirectory) {
        var descriptorPath = Path.Combine(assemblyDirectory, RevitDeploymentIdentity.RuntimeDescriptorFileName);
        return PeAppRuntimeDeploymentDescriptor.TryLoad(descriptorPath, out var descriptor)
               && descriptor is not null;
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

    private static void RemoveInstalledRevitAddinPath(Session session, string yearDirectory) {
        var assemblyDirectory = Path.Combine(yearDirectory, RevitDeploymentIdentity.AddinAssemblyDirectoryName);
        var manifestPath = Path.Combine(yearDirectory, RevitDeploymentIdentity.AddinManifestFileName);
        var descriptorPath = Path.Combine(assemblyDirectory, RevitDeploymentIdentity.RuntimeDescriptorFileName);

        if (PeAppRuntimeDeploymentDescriptor.TryLoad(descriptorPath, out var descriptor)
            && descriptor?.RuntimeLane == ProductRuntimeLane.Dev) {
            session.Log($"Skipping dev-lane Revit add-in path: {assemblyDirectory}");
            return;
        }

        TryDeleteFile(session, manifestPath);
        TryDeleteDirectory(session, assemblyDirectory);
    }

    private static bool IsRevitYearDirectory(string path) {
        var name = Path.GetFileName(path);
        return name.Length == 4
               && name.StartsWith("20", StringComparison.Ordinal)
               && name.All(char.IsDigit);
    }

    private static void TryDeleteFile(Session session, string path) {
        try {
            if (File.Exists(path)) {
                File.Delete(path);
                session.Log($"Removed file: {path}");
            }
        } catch (Exception ex) {
            session.Log($"Could not remove file '{path}': {ex.Message}");
        }
    }

    private static void TryDeleteDirectory(Session session, string path) {
        try {
            if (Directory.Exists(path)) {
                Directory.Delete(path, true);
                session.Log($"Removed directory: {path}");
            }
        } catch (Exception ex) {
            session.Log($"Could not remove directory '{path}': {ex.Message}");
        }
    }

    private static string ComputeSha256(string path) {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
