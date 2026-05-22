using Pe.Shared.HostContracts.Protocol;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

namespace Pe.Dev.Cli;

internal sealed record RuntimeAssemblyDiskData(
    string Name,
    string? Version,
    string Location,
    string ModuleVersionId
);

internal sealed record RuntimeAssemblyMismatch(
    HostRuntimeAssemblyData Loaded,
    RuntimeAssemblyDiskData? Disk,
    string Reason
);

internal sealed record RuntimeAssemblyGraphComparison(
    IReadOnlyList<RuntimeAssemblyMismatch> Mismatches,
    IReadOnlyList<HostRuntimeAssemblyData> MissingLocations,
    IReadOnlyList<RuntimeAssemblyDiskData> DiskAssemblies
) {
    public bool HasComparableAssemblies => this.DiskAssemblies.Count > 0;
    public bool HasMismatches => this.Mismatches.Count > 0 || this.MissingLocations.Count > 0;
}

internal static class RuntimeAssemblyGraph {
    public static RuntimeAssemblyGraphComparison CompareLoadedToDisk(HostSessionSummaryData? summary) {
        if (summary?.RuntimeAssemblies is null || summary.RuntimeAssemblies.Count == 0)
            return new RuntimeAssemblyGraphComparison([], [], []);

        var diskAssemblies = new List<RuntimeAssemblyDiskData>();
        var mismatches = new List<RuntimeAssemblyMismatch>();
        var missingLocations = new List<HostRuntimeAssemblyData>();

        foreach (var loaded in summary.RuntimeAssemblies.OrderBy(assembly => assembly.Name, StringComparer.OrdinalIgnoreCase)) {
            if (string.IsNullOrWhiteSpace(loaded.Location)) {
                missingLocations.Add(loaded);
                continue;
            }

            if (!File.Exists(loaded.Location)) {
                mismatches.Add(new RuntimeAssemblyMismatch(loaded, null, "loaded assembly location no longer exists on disk"));
                continue;
            }

            RuntimeAssemblyDiskData disk;
            try {
                disk = ReadDiskAssembly(loaded.Location);
            } catch (Exception ex) {
                mismatches.Add(new RuntimeAssemblyMismatch(loaded, null, $"could not read disk assembly: {ex.Message}"));
                continue;
            }

            diskAssemblies.Add(disk);
            if (!string.Equals(loaded.ModuleVersionId, disk.ModuleVersionId, StringComparison.OrdinalIgnoreCase)) {
                mismatches.Add(new RuntimeAssemblyMismatch(loaded, disk, "loaded MVID differs from disk output MVID"));
                continue;
            }

            if (!string.Equals(loaded.Version, disk.Version, StringComparison.OrdinalIgnoreCase))
                mismatches.Add(new RuntimeAssemblyMismatch(loaded, disk, "loaded version differs from disk output version"));
        }

        return new RuntimeAssemblyGraphComparison(mismatches, missingLocations, diskAssemblies);
    }

    public static string? TryCreateFingerprint(HostSessionSummaryData? summary) {
        if (summary?.RuntimeAssemblies is null || summary.RuntimeAssemblies.Count == 0)
            return null;

        var joined = string.Join(
            "|",
            summary.RuntimeAssemblies
                .OrderBy(assembly => assembly.Name, StringComparer.OrdinalIgnoreCase)
                .Select(assembly => $"{assembly.Name}:{assembly.ModuleVersionId}")
        );
        return string.IsNullOrWhiteSpace(joined)
            ? null
            : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(joined)))[..12];
    }

    private static RuntimeAssemblyDiskData ReadDiskAssembly(string path) {
        var assemblyName = AssemblyName.GetAssemblyName(path);
        using var stream = File.OpenRead(path);
        using var peReader = new PEReader(stream);
        var metadataReader = peReader.GetMetadataReader();
        var moduleDefinition = metadataReader.GetModuleDefinition();
        var mvid = metadataReader.GetGuid(moduleDefinition.Mvid).ToString("D");

        return new RuntimeAssemblyDiskData(
            assemblyName.Name ?? Path.GetFileNameWithoutExtension(path),
            assemblyName.Version?.ToString(),
            path,
            mvid
        );
    }
}
