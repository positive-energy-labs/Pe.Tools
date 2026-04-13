using System.Text.RegularExpressions;
using NuGet.Frameworks;
using NuGet.Packaging;
using NuGet.Versioning;
using Pe.Revit.Scripting.Diagnostics;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.References;

public sealed class ScriptReferenceResolver(
    CsProjReader csProjReader
) {
    private readonly CsProjReader _csProjReader = csProjReader;

    public ResolvedScriptProject Resolve(
        string projectContent,
        string workspaceRoot,
        string? revitVersion = null
    ) {
        var diagnostics = new List<Pe.Shared.HostContracts.Scripting.ScriptDiagnostic>();
        var compileReferencePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var runtimeReferencePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        try {
            var project = this._csProjReader.Read(projectContent, workspaceRoot);
            foreach (var reference in project.References) {
                var resolvedPath = this.ResolveHintPath(
                    reference.HintPath,
                    project.ProjectDirectory,
                    workspaceRoot,
                    revitVersion
                );
                if (!File.Exists(resolvedPath)) {
                    diagnostics.Add(ScriptDiagnosticFactory.Error(
                        "resolve",
                        $"Reference hint path not found: {resolvedPath}",
                        reference.Include
                    ));
                    continue;
                }

                _ = compileReferencePaths.Add(resolvedPath);
                _ = runtimeReferencePaths.Add(resolvedPath);
                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Resolved reference hint path: {resolvedPath}",
                    reference.Include
                ));
            }

            foreach (var packageReference in project.PackageReferences) {
                var packageResult = this.ResolvePackageReference(
                    packageReference.Include,
                    packageReference.Version,
                    project.TargetFramework,
                    revitVersion
                );
                diagnostics.AddRange(packageResult.Diagnostics);
                foreach (var assemblyPath in packageResult.CompileReferencePaths)
                    _ = compileReferencePaths.Add(assemblyPath);
                foreach (var assemblyPath in packageResult.RuntimeReferencePaths)
                    _ = runtimeReferencePaths.Add(assemblyPath);
            }

            return new ResolvedScriptProject(
                project.ProjectContent,
                project.TargetFramework,
                compileReferencePaths.ToList(),
                runtimeReferencePaths.ToList(),
                diagnostics
            );
        } catch (Exception ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "resolve",
                $"Project resolution failed: {ex.Message}"
            ));
            return new ResolvedScriptProject(projectContent, string.Empty, [], [], diagnostics);
        }
    }

    private string ResolveHintPath(
        string hintPath,
        string? projectDirectory,
        string workspaceRoot,
        string? revitVersion
    ) {
        hintPath = ExpandRevitPlaceholders(hintPath, revitVersion) ?? string.Empty;
        if (Path.IsPathRooted(hintPath))
            return Path.GetFullPath(hintPath);

        var baseDirectory = string.IsNullOrWhiteSpace(projectDirectory) ? workspaceRoot : projectDirectory;
        return Path.GetFullPath(Path.Combine(baseDirectory, hintPath));
    }

    private PackageResolutionResult ResolvePackageReference(
        string packageName,
        string? packageVersion,
        string targetFramework,
        string? revitVersion
    ) {
        var diagnostics = new List<Pe.Shared.HostContracts.Scripting.ScriptDiagnostic>();
        var compileReferencePaths = new List<string>();
        var runtimeReferencePaths = new List<string>();
        var alreadyLoadedRuntimePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        try {
            packageVersion = ExpandRevitPlaceholders(packageVersion, revitVersion);
            var nugetRoot = Environment.GetEnvironmentVariable("NUGET_PACKAGES");
            if (string.IsNullOrWhiteSpace(nugetRoot)) {
                nugetRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".nuget",
                    "packages"
                );
            }

            if (!Directory.Exists(nugetRoot)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"NuGet package cache not found: {nugetRoot}",
                    packageName
                ));
                return new PackageResolutionResult([], [], diagnostics);
            }

            var packageDirectory = Path.Combine(nugetRoot, packageName.ToLowerInvariant());
            if (!Directory.Exists(packageDirectory)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"Package '{packageName}' is not installed in the NuGet cache.",
                    packageName
                ));
                return new PackageResolutionResult([], [], diagnostics);
            }

            var versionDirectory = this.ResolvePackageVersionDirectory(packageDirectory, packageVersion);
            if (string.IsNullOrWhiteSpace(versionDirectory)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"No installed version matched '{packageVersion ?? "<latest>"}' for package '{packageName}'.",
                    packageName
                ));
                return new PackageResolutionResult([], [], diagnostics);
            }

            diagnostics.Add(ScriptDiagnosticFactory.Info(
                "resolve",
                $"Resolved package '{packageName}' to '{versionDirectory}'.",
                packageName
            ));

            var assetSelection = this.ResolvePackageAssemblies(versionDirectory, targetFramework);
            if (assetSelection.CompileReferencePaths.Count == 0) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"No compatible compile assemblies were found for package '{packageName}'.",
                    packageName
                ));
                return new PackageResolutionResult([], [], diagnostics);
            }

            compileReferencePaths.AddRange(assetSelection.CompileReferencePaths);
            runtimeReferencePaths.AddRange(assetSelection.RuntimeReferencePaths);

            if (runtimeReferencePaths.Count == 0 && compileReferencePaths.Count != 0) {
                var loadedRuntimePaths = ResolveAlreadyLoadedRuntimePaths(compileReferencePaths);
                runtimeReferencePaths.AddRange(loadedRuntimePaths);
                foreach (var assemblyPath in loadedRuntimePaths) {
                    _ = alreadyLoadedRuntimePaths.Add(assemblyPath);
                    diagnostics.Add(ScriptDiagnosticFactory.Info(
                        "resolve",
                        $"Using already-loaded runtime assembly: {assemblyPath}",
                        packageName
                    ));
                }
            }

            foreach (var assemblyPath in assetSelection.CompileReferencePaths) {
                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Resolved package compile assembly: {assemblyPath}",
                    packageName
                ));
            }

            foreach (var assemblyPath in runtimeReferencePaths) {
                if (alreadyLoadedRuntimePaths.Contains(assemblyPath))
                    continue;

                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Resolved package runtime assembly: {assemblyPath}",
                    packageName
                ));
            }

            if (runtimeReferencePaths.Count == 0) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"Package '{packageName}' resolved compile assemblies but no compatible runtime assemblies.",
                    packageName
                ));
            }

            return new PackageResolutionResult(compileReferencePaths, runtimeReferencePaths, diagnostics);
        } catch (Exception ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "resolve",
                $"Failed to resolve package '{packageName}': {ex.Message}",
                packageName
            ));
            return new PackageResolutionResult([], [], diagnostics);
        }
    }

    private string? ResolvePackageVersionDirectory(string packageDirectory, string? packageVersion) {
        if (!string.IsNullOrWhiteSpace(packageVersion) && !packageVersion.Contains('*')) {
            var exactDirectory = Path.Combine(packageDirectory, packageVersion);
            if (Directory.Exists(exactDirectory))
                return exactDirectory;
        }

        if (!string.IsNullOrWhiteSpace(packageVersion) && packageVersion.Contains('*'))
            return this.GetLatestVersionDirectoryMatchingWildcard(packageDirectory, packageVersion);

        return this.GetLatestVersionDirectory(packageDirectory);
    }

    private string? GetLatestVersionDirectory(string packageDirectory) {
        var versionDirectory = Directory
            .GetDirectories(packageDirectory)
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => new { Name = name!, IsParsed = NuGetVersion.TryParse(name, out var version), Version = version })
            .Where(item => item.IsParsed)
            .OrderByDescending(item => item.Version)
            .FirstOrDefault();

        return versionDirectory == null
            ? null
            : Path.Combine(packageDirectory, versionDirectory.Name);
    }

    private string? GetLatestVersionDirectoryMatchingWildcard(
        string packageDirectory,
        string wildcardVersion
    ) {
        var regex = new Regex(
            "^" + Regex.Escape(wildcardVersion).Replace("\\*", ".*") + "$",
            RegexOptions.IgnoreCase
        );

        var versionDirectory = Directory
            .GetDirectories(packageDirectory)
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrWhiteSpace(name) && regex.IsMatch(name))
            .Select(name => new { Name = name!, IsParsed = NuGetVersion.TryParse(name, out var version), Version = version })
            .Where(item => item.IsParsed)
            .OrderByDescending(item => item.Version)
            .FirstOrDefault();

        return versionDirectory == null
            ? null
            : Path.Combine(packageDirectory, versionDirectory.Name);
    }

    private PackageAssetSelection ResolvePackageAssemblies(
        string versionDirectory,
        string targetFramework
    ) {
        var reducer = new FrameworkReducer();
        var projectFramework = this.ParseProjectFramework(targetFramework);
        IReadOnlyList<FrameworkSpecificGroup> referenceGroups = [];
        IReadOnlyList<FrameworkSpecificGroup> libGroups = [];
        IReadOnlyList<FrameworkSpecificGroup> runtimeGroups = [];

        try {
            using var packageReader = new PackageFolderReader(versionDirectory);
            referenceGroups = packageReader.GetReferenceItems()?.ToList() ?? [];
            libGroups = packageReader.GetLibItems()?.ToList() ?? [];
            runtimeGroups = packageReader.GetItems("runtimes")?.ToList() ?? [];
        } catch {
            // Allow bare folder layouts during tests and pragmatic local cache probing.
        }

        var compileReferencePaths = this.SelectAssemblies(
            versionDirectory,
            referenceGroups,
            projectFramework,
            reducer
        );
        compileReferencePaths = this.FilterCompatibleAssetPaths(compileReferencePaths, projectFramework);
        if (compileReferencePaths.Count == 0) {
            compileReferencePaths = this.SelectAssembliesFromAssetDirectory(
                Path.Combine(versionDirectory, "ref"),
                projectFramework,
                reducer
            );
            compileReferencePaths = this.FilterCompatibleAssetPaths(compileReferencePaths, projectFramework);
        }

        if (compileReferencePaths.Count == 0) {
            compileReferencePaths = this.SelectAssemblies(
                versionDirectory,
                libGroups,
                projectFramework,
                reducer
            );
            compileReferencePaths = this.FilterCompatibleAssetPaths(compileReferencePaths, projectFramework);
        }
        if (compileReferencePaths.Count == 0) {
            compileReferencePaths = this.SelectAssembliesFromAssetDirectory(
                Path.Combine(versionDirectory, "lib"),
                projectFramework,
                reducer
            );
            compileReferencePaths = this.FilterCompatibleAssetPaths(compileReferencePaths, projectFramework);
        }

        var runtimeReferencePaths = this.SelectRuntimeAssemblies(
            versionDirectory,
            runtimeGroups,
            projectFramework,
            reducer
        );
        runtimeReferencePaths = this.FilterCompatibleAssetPaths(runtimeReferencePaths, projectFramework);
        if (runtimeReferencePaths.Count == 0) {
            runtimeReferencePaths = this.SelectAssembliesFromRuntimeDirectory(
                Path.Combine(versionDirectory, "runtimes"),
                projectFramework,
                reducer
            );
            runtimeReferencePaths = this.FilterCompatibleAssetPaths(runtimeReferencePaths, projectFramework);
        }

        if (runtimeReferencePaths.Count == 0) {
            runtimeReferencePaths = this.SelectAssemblies(
                versionDirectory,
                libGroups,
                projectFramework,
                reducer
            );
            runtimeReferencePaths = this.FilterCompatibleAssetPaths(runtimeReferencePaths, projectFramework);
        }
        if (runtimeReferencePaths.Count == 0) {
            runtimeReferencePaths = this.SelectAssembliesFromAssetDirectory(
                Path.Combine(versionDirectory, "lib"),
                projectFramework,
                reducer
            );
            runtimeReferencePaths = this.FilterCompatibleAssetPaths(runtimeReferencePaths, projectFramework);
        }

        return new PackageAssetSelection(compileReferencePaths, runtimeReferencePaths);
    }

    private IReadOnlyList<string> SelectRuntimeAssemblies(
        string versionDirectory,
        IReadOnlyList<FrameworkSpecificGroup> groups,
        NuGetFramework? projectFramework,
        FrameworkReducer reducer
    ) {
        var runtimeGroups = groups
            .Where(group =>
                !group.HasEmptyFolder
                && (group.Items ?? Array.Empty<string>()).Any(item =>
                    item.StartsWith("runtimes/", StringComparison.OrdinalIgnoreCase)
                    && item.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                ))
            .ToList();
        if (runtimeGroups.Count == 0)
            return [];

        return this.SelectAssemblies(
            versionDirectory,
            runtimeGroups,
            projectFramework,
            reducer
        );
    }

    private NuGetFramework? ParseProjectFramework(string targetFramework) {
        if (string.IsNullOrWhiteSpace(targetFramework))
            return null;

        var normalizedFramework = targetFramework;
        var platformSeparatorIndex = normalizedFramework.IndexOf('-');
        if (platformSeparatorIndex >= 0)
            normalizedFramework = normalizedFramework[..platformSeparatorIndex];

        var parsed = NuGetFramework.ParseFolder(normalizedFramework);
        return parsed == NuGetFramework.UnsupportedFramework ? null : parsed;
    }

    private IReadOnlyList<string> SelectAssemblies(
        string versionDirectory,
        IReadOnlyList<FrameworkSpecificGroup> groups,
        NuGetFramework? projectFramework,
        FrameworkReducer reducer
    ) {
        if (groups.Count == 0)
            return [];

        FrameworkSpecificGroup? chosenGroup = null;
        if (projectFramework != null) {
            chosenGroup = SelectExactFrameworkGroup(groups, projectFramework)
                ?? SelectSameFrameworkFallback(groups, projectFramework);
        }

        chosenGroup ??=
            groups.FirstOrDefault(group => group.TargetFramework.GetShortFolderName().Equals("netstandard2.1", StringComparison.OrdinalIgnoreCase))
            ?? groups.FirstOrDefault(group => group.TargetFramework.GetShortFolderName().Equals("netstandard2.0", StringComparison.OrdinalIgnoreCase));

        if (chosenGroup == null && projectFramework == null) {
            chosenGroup = groups.OrderByDescending(group =>
                (group.Items ?? Array.Empty<string>()).Count(item => item.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            ).FirstOrDefault();
        }

        if (chosenGroup == null || chosenGroup.HasEmptyFolder)
            return [];

        return (chosenGroup.Items ?? Array.Empty<string>())
            .Where(item => item.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            .Select(item => Path.Combine(versionDirectory, item))
            .Where(File.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private IReadOnlyList<string> SelectAssembliesFromAssetDirectory(
        string assetRoot,
        NuGetFramework? projectFramework,
        FrameworkReducer reducer
    ) {
        if (!Directory.Exists(assetRoot))
            return [];

        var directDlls = Directory.GetFiles(assetRoot, "*.dll", SearchOption.TopDirectoryOnly)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (directDlls.Count != 0)
            return directDlls;

        var groups = Directory.GetDirectories(assetRoot)
            .Select(directoryPath => new DirectoryAssetGroup(
                directoryPath,
                this.ParsePackageFolderFramework(Path.GetFileName(directoryPath))
            ))
            .ToList();
        if (groups.Count == 0)
            return [];

        var selectedGroup = this.SelectDirectoryAssetGroup(groups, projectFramework, reducer);
        if (selectedGroup == null)
            return [];

        return Directory.GetFiles(selectedGroup.DirectoryPath, "*.dll", SearchOption.TopDirectoryOnly)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private IReadOnlyList<string> SelectAssembliesFromRuntimeDirectory(
        string runtimesRoot,
        NuGetFramework? projectFramework,
        FrameworkReducer reducer
    ) {
        if (!Directory.Exists(runtimesRoot))
            return [];

        var groups = Directory.GetDirectories(runtimesRoot, "*", SearchOption.AllDirectories)
            .Where(directoryPath => string.Equals(
                Path.GetFileName(Path.GetDirectoryName(directoryPath)),
                "lib",
                StringComparison.OrdinalIgnoreCase
            ))
            .Select(directoryPath => new DirectoryAssetGroup(
                directoryPath,
                this.ParsePackageFolderFramework(Path.GetFileName(directoryPath))
            ))
            .Where(group => Directory.GetFiles(group.DirectoryPath, "*.dll", SearchOption.TopDirectoryOnly).Length != 0)
            .ToList();
        if (groups.Count == 0)
            return [];

        var selectedGroup = this.SelectDirectoryAssetGroup(groups, projectFramework, reducer);
        if (selectedGroup == null)
            return [];

        return Directory.GetFiles(selectedGroup.DirectoryPath, "*.dll", SearchOption.TopDirectoryOnly)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private DirectoryAssetGroup? SelectDirectoryAssetGroup(
        IReadOnlyList<DirectoryAssetGroup> groups,
        NuGetFramework? projectFramework,
        FrameworkReducer reducer
    ) {
        if (groups.Count == 0)
            return null;

        DirectoryAssetGroup? chosenGroup = null;
        if (projectFramework != null) {
            chosenGroup = SelectExactDirectoryFrameworkGroup(groups, projectFramework)
                ?? SelectSameDirectoryFrameworkFallback(groups, projectFramework);
        }

        chosenGroup ??=
            groups.FirstOrDefault(group => string.Equals(
                Path.GetFileName(group.DirectoryPath),
                "netstandard2.1",
                StringComparison.OrdinalIgnoreCase
            ))
            ?? groups.FirstOrDefault(group => string.Equals(
                Path.GetFileName(group.DirectoryPath),
                "netstandard2.0",
                StringComparison.OrdinalIgnoreCase
            ));

        if (chosenGroup == null && projectFramework == null) {
            chosenGroup = groups.OrderByDescending(group =>
                Directory.GetFiles(group.DirectoryPath, "*.dll", SearchOption.TopDirectoryOnly).Length
            ).FirstOrDefault();
        }

        return chosenGroup;
    }

    private NuGetFramework? ParsePackageFolderFramework(string? folderName) {
        if (string.IsNullOrWhiteSpace(folderName))
            return null;

        var parsed = NuGetFramework.ParseFolder(folderName);
        return parsed == NuGetFramework.UnsupportedFramework ? null : parsed;
    }

    private static FrameworkSpecificGroup? SelectExactFrameworkGroup(
        IReadOnlyList<FrameworkSpecificGroup> groups,
        NuGetFramework projectFramework
    ) {
        var projectShortFolder = projectFramework.GetShortFolderName();
        return groups.FirstOrDefault(group =>
            group.TargetFramework.GetShortFolderName().Equals(projectShortFolder, StringComparison.OrdinalIgnoreCase));
    }

    private static FrameworkSpecificGroup? SelectSameFrameworkFallback(
        IReadOnlyList<FrameworkSpecificGroup> groups,
        NuGetFramework projectFramework
    ) => groups
        .Where(group =>
            string.Equals(group.TargetFramework.Framework, projectFramework.Framework, StringComparison.OrdinalIgnoreCase)
            && group.TargetFramework.Version <= projectFramework.Version)
        .OrderByDescending(group => group.TargetFramework.Version)
        .FirstOrDefault();

    private static DirectoryAssetGroup? SelectExactDirectoryFrameworkGroup(
        IReadOnlyList<DirectoryAssetGroup> groups,
        NuGetFramework projectFramework
    ) {
        var projectShortFolder = projectFramework.GetShortFolderName();
        return groups.FirstOrDefault(group =>
            string.Equals(
                group.Framework?.GetShortFolderName(),
                projectShortFolder,
                StringComparison.OrdinalIgnoreCase
            ));
    }

    private static DirectoryAssetGroup? SelectSameDirectoryFrameworkFallback(
        IReadOnlyList<DirectoryAssetGroup> groups,
        NuGetFramework projectFramework
    ) => groups
        .Where(group =>
            group.Framework != null
            && string.Equals(group.Framework.Framework, projectFramework.Framework, StringComparison.OrdinalIgnoreCase)
            && group.Framework.Version <= projectFramework.Version)
        .OrderByDescending(group => group.Framework!.Version)
        .FirstOrDefault();

    private static IReadOnlyList<string> ResolveAlreadyLoadedRuntimePaths(
        IReadOnlyList<string> compileReferencePaths
    ) {
        var loadedAssemblies = AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => !assembly.IsDynamic && !string.IsNullOrWhiteSpace(assembly.Location) && File.Exists(assembly.Location))
            .ToDictionary(
                assembly => assembly.GetName().Name ?? string.Empty,
                assembly => assembly.Location,
                StringComparer.OrdinalIgnoreCase
            );

        return compileReferencePaths
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => loadedAssemblies.TryGetValue(name!, out var loadedPath) ? loadedPath : null)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList()!;
    }

    private static string? ExpandRevitPlaceholders(string? value, string? revitVersion) {
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(revitVersion))
            return value;

        return value
            .Replace("$(RevitVersion)", revitVersion, StringComparison.OrdinalIgnoreCase)
            .Replace("$(RevitYear)", revitVersion, StringComparison.OrdinalIgnoreCase);
    }

    private IReadOnlyList<string> FilterCompatibleAssetPaths(
        IReadOnlyList<string> assetPaths,
        NuGetFramework? projectFramework
    ) {
        if (assetPaths.Count == 0 || projectFramework == null)
            return assetPaths.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var exactMatches = assetPaths
            .Where(path => string.Equals(
                Path.GetFileName(Path.GetDirectoryName(path)),
                projectFramework.GetShortFolderName(),
                StringComparison.OrdinalIgnoreCase
            ))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (exactMatches.Count != 0)
            return exactMatches;

        var sameFrameworkMatches = assetPaths
            .Select(path => new {
                Path = path, Framework = this.ParsePackageFolderFramework(Path.GetFileName(Path.GetDirectoryName(path)))
            })
            .Where(item =>
                item.Framework != null
                && string.Equals(item.Framework.Framework, projectFramework.Framework, StringComparison.OrdinalIgnoreCase)
                && item.Framework.Version <= projectFramework.Version)
            .OrderByDescending(item => item.Framework!.Version)
            .ToList();
        if (sameFrameworkMatches.Count != 0) {
            var highestVersion = sameFrameworkMatches[0].Framework!.Version;
            return sameFrameworkMatches
                .Where(item => item.Framework!.Version == highestVersion)
                .Select(item => item.Path)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var netStandardMatches = assetPaths
            .Where(path => {
                var folder = Path.GetFileName(Path.GetDirectoryName(path));
                return string.Equals(folder, "netstandard2.1", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(folder, "netstandard2.0", StringComparison.OrdinalIgnoreCase);
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (netStandardMatches.Count != 0)
            return netStandardMatches;

        return [];
    }

    private sealed record PackageResolutionResult(
        IReadOnlyList<string> CompileReferencePaths,
        IReadOnlyList<string> RuntimeReferencePaths,
        IReadOnlyList<Pe.Shared.HostContracts.Scripting.ScriptDiagnostic> Diagnostics
    );

    private sealed record PackageAssetSelection(
        IReadOnlyList<string> CompileReferencePaths,
        IReadOnlyList<string> RuntimeReferencePaths
    );

    private sealed record DirectoryAssetGroup(
        string DirectoryPath,
        NuGetFramework? Framework
    );
}
