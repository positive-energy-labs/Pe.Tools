using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Loader;

namespace Toon.Tests;

internal static class RevitApiAssemblyResolver {
    private static readonly string[] _resolvableAssemblyNames = [
        "RevitAPI",
        "RevitAPIUI",
        "AdWindows",
        "UIFramework",
        "UIFrameworkServices"
    ];

    private static readonly string[] _candidateDirectories = BuildCandidateDirectories();

    [ModuleInitializer]
    public static void Initialize() {
        AppDomain.CurrentDomain.AssemblyResolve += ResolveFromCandidates;
        AssemblyLoadContext.Default.Resolving += ResolveFromCandidates;
    }

    private static Assembly? ResolveFromCandidates(object? sender, ResolveEventArgs args) =>
        ResolveAssembly(new AssemblyName(args.Name));

    private static Assembly? ResolveFromCandidates(AssemblyLoadContext? context, AssemblyName assemblyName) =>
        ResolveAssembly(assemblyName);

    private static Assembly? ResolveAssembly(AssemblyName assemblyName) {
        var simpleName = assemblyName.Name;
        if (string.IsNullOrWhiteSpace(simpleName) ||
            !_resolvableAssemblyNames.Contains(simpleName, StringComparer.OrdinalIgnoreCase)) {
            return null;
        }

        foreach (var directory in _candidateDirectories) {
            var candidatePath = Path.Combine(directory, $"{simpleName}.dll");
            if (!File.Exists(candidatePath))
                continue;

            try {
                return Assembly.LoadFrom(candidatePath);
            } catch {
                // Keep probing other directories.
            }
        }

        return null;
    }

    private static string[] BuildCandidateDirectories() {
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var envDirectory = Environment.GetEnvironmentVariable("REVIT_API_DIR");
        AddIfValid(directories, envDirectory);

        var processDirectory = GetRunningRevitDirectory();
        AddIfValid(directories, processDirectory);

        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        foreach (var year in new[] { "2026", "2025", "2024", "2023" }) {
            AddIfValid(directories, Path.Combine(programFiles, "Autodesk", $"Revit {year}"));
        }

        return directories.ToArray();
    }

    private static string? GetRunningRevitDirectory() {
        try {
            var process = System.Diagnostics.Process
                .GetProcessesByName("Revit")
                .FirstOrDefault();
            var executablePath = process?.MainModule?.FileName;
            return string.IsNullOrWhiteSpace(executablePath)
                ? null
                : Path.GetDirectoryName(executablePath);
        } catch {
            return null;
        }
    }

    private static void AddIfValid(HashSet<string> set, string? candidate) {
        if (string.IsNullOrWhiteSpace(candidate))
            return;
        if (!Directory.Exists(candidate))
            return;
        _ = set.Add(candidate);
    }
}
