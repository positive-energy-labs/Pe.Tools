using System.Xml.Linq;

namespace Build;

internal static class BuildProjectDiscovery {
    public static string FindSingleProjectByKind(string repositoryRoot, string kind) {
        var projects = Directory.EnumerateFiles(repositoryRoot, "*.csproj", SearchOption.AllDirectories)
            .Where(path => !path.Split(Path.DirectorySeparatorChar).Any(segment => segment is ".artifacts" or "bin" or "obj" or ".git" or "node_modules"))
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
}
