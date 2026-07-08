using System.Xml.Linq;

namespace Build;

internal static class BuildProjectDiscovery {
    private static readonly HashSet<string> IgnoredDirectories = new(StringComparer.OrdinalIgnoreCase) {
        ".artifacts",
        ".git",
        "bin",
        "dist",
        "dist-installed",
        "node_modules",
        "obj"
    };

    public static string FindSingleProjectByKind(string repositoryRoot, string kind) {
        var projects = EnumerateProjectFiles(repositoryRoot)
            .Where(path => IsProjectKind(path, kind))
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return projects.Length switch {
            1 => projects[0],
            0 => throw new InvalidOperationException($"No PeProjectKind={kind} project was found under {repositoryRoot}."),
            _ => throw new InvalidOperationException($"Multiple PeProjectKind={kind} projects were found under {repositoryRoot}: {string.Join(", ", projects.Select(Path.GetFileNameWithoutExtension))}.")
        };
    }

    public static string AssemblyName(string projectPath) {
        var document = XDocument.Load(projectPath);
        var assemblyName = document.Descendants()
            .FirstOrDefault(element => element.Name.LocalName == "AssemblyName")
            ?.Value
            .Trim();

        return string.IsNullOrWhiteSpace(assemblyName)
            ? Path.GetFileNameWithoutExtension(projectPath)
            : assemblyName;
    }

    private static bool IsProjectKind(string projectPath, string kind) {
        try {
            return XDocument.Load(projectPath).Descendants()
                .Any(element => element.Name.LocalName == "PeProjectKind" && element.Value.Trim().Equals(kind, StringComparison.OrdinalIgnoreCase));
        } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or System.Xml.XmlException) {
            return false;
        }
    }

    private static IEnumerable<string> EnumerateProjectFiles(string directory) {
        IEnumerable<string> files;
        try {
            files = Directory.EnumerateFiles(directory, "*.csproj", SearchOption.TopDirectoryOnly);
        } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
            yield break;
        }

        foreach (var file in files)
            yield return file;

        IEnumerable<string> children;
        try {
            children = Directory.EnumerateDirectories(directory, "*", SearchOption.TopDirectoryOnly)
                .Where(ShouldEnterDirectory)
                .ToArray();
        } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
            yield break;
        }

        foreach (var child in children) {
            foreach (var file in EnumerateProjectFiles(child))
                yield return file;
        }
    }

    private static bool ShouldEnterDirectory(string directory) {
        var name = Path.GetFileName(directory);
        if (IgnoredDirectories.Contains(name))
            return false;

        try {
            return !new DirectoryInfo(directory).Attributes.HasFlag(FileAttributes.ReparsePoint);
        } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
            return false;
        }
    }
}
