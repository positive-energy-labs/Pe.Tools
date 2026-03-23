using System.Reflection;
using System.Runtime.Loader;

namespace Pe.Host.Services;

public static class HostRevitAssemblyResolver {
    private static int _initialized;

    public static void EnsureRegistered() {
        if (Interlocked.Exchange(ref _initialized, 1) == 1)
            return;

        AssemblyLoadContext.Default.Resolving += Resolve;
    }

    private static Assembly? Resolve(AssemblyLoadContext loadContext, AssemblyName assemblyName) {
        foreach (var candidatePath in GetCandidatePaths(assemblyName)) {
            if (!File.Exists(candidatePath))
                continue;

            return loadContext.LoadFromAssemblyPath(candidatePath);
        }

        return null;
    }

    private static IEnumerable<string> GetCandidatePaths(AssemblyName assemblyName) =>
        GetCandidateDirectories(assemblyName)
            .Select(directory => Path.Combine(directory, $"{assemblyName.Name}.dll"))
            .Distinct(StringComparer.OrdinalIgnoreCase);

    private static IEnumerable<string> GetCandidateDirectories(AssemblyName assemblyName) {
        var explicitDirectory = Environment.GetEnvironmentVariable("PE_HOST_REVIT_ASSEMBLY_DIR");
        if (!string.IsNullOrWhiteSpace(explicitDirectory))
            yield return explicitDirectory;

        var versionedDirectory = TryGetVersionedInstallDirectory(assemblyName.Version);
        if (!string.IsNullOrWhiteSpace(versionedDirectory))
            yield return versionedDirectory;

        var autodeskDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "Autodesk"
        );
        if (!Directory.Exists(autodeskDirectory))
            yield break;

        foreach (var directory in Directory.EnumerateDirectories(autodeskDirectory, "Revit *"))
            yield return directory;
    }

    private static string? TryGetVersionedInstallDirectory(Version? version) {
        var majorVersion = version?.Major;
        if (majorVersion is null or < 20 or > 99)
            return null;

        var revitYear = 2000 + majorVersion.Value;
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "Autodesk",
            $"Revit {revitYear}"
        );
    }
}
