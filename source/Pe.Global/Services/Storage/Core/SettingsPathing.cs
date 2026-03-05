using Pe.Global.PolyFill;

namespace Pe.Global.Services.Storage.Core;

/// <summary>
///     Shared helpers for safe settings path resolution and settings discovery projections.
/// </summary>
public static class SettingsPathing {
    private const string GlobalSchemaNamespace = "global";

    public enum DirectiveScope {
        Local,
        Global
    }

    public readonly record struct ResolvedDirective(
        string OriginalPath,
        DirectiveScope Scope,
        string RelativePath,
        string RootSegment,
        string RootDirectory
    );

    public readonly record struct DirectiveFileCandidates(string JsonPath, string? ToonPath);

    public static string ResolveCentralizedProfileSchemaPath(string schemaContextDirectory, Type profileType) {
        if (profileType == null)
            throw new ArgumentNullException(nameof(profileType));

        var fileName = $"{BuildProfileTypeSchemaKey(profileType)}.schema.json";
        var namespaceDirectory = ResolveCentralizedSchemaNamespaceDirectory(schemaContextDirectory);
        return Path.Combine(namespaceDirectory, "profiles", fileName);
    }

    public static string ResolveCentralizedFragmentSchemaPath(
        string schemaContextDirectory,
        DirectiveScope directiveScope,
        bool isPresetDirective,
        string rootSegment
    ) {
        if (string.IsNullOrWhiteSpace(rootSegment))
            throw new ArgumentException("Root segment is required.", nameof(rootSegment));

        var namespaceDirectory = directiveScope == DirectiveScope.Global
            ? ResolveCentralizedSchemaNamespaceDirectory(schemaContextDirectory, GlobalSchemaNamespace)
            : ResolveCentralizedSchemaNamespaceDirectory(schemaContextDirectory);
        var schemaKind = isPresetDirective ? "preset" : "include";
        var schemaFileName = $"{NormalizeSchemaKey(rootSegment)}.schema.json";
        return Path.Combine(namespaceDirectory, "fragments", schemaKind, rootSegment, schemaFileName);
    }

    public static string ResolveCentralizedSchemaNamespaceDirectory(
        string schemaContextDirectory,
        string? namespaceOverride = null
    ) {
        if (string.IsNullOrWhiteSpace(schemaContextDirectory))
            throw new ArgumentException("Schema context directory is required.", nameof(schemaContextDirectory));

        var normalizedContextDirectory = Path.GetFullPath(schemaContextDirectory);
        var (baseDirectory, addinNamespace) = TryResolveStorageBaseAndNamespace(normalizedContextDirectory);
        var schemaNamespace = string.IsNullOrWhiteSpace(namespaceOverride)
            ? addinNamespace
            : NormalizeSchemaKey(namespaceOverride);

        return Path.Combine(baseDirectory, "Global", "schemas", schemaNamespace);
    }

    public static string ResolveSafeSubDirectoryPath(string rootPath, string? subdirectory, string paramName) {
        var normalized = NormalizeRelativePath(subdirectory, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            return rootPath;

        var combined = Path.GetFullPath(Path.Combine(rootPath, normalized.Replace('/', Path.DirectorySeparatorChar)));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string ResolveSafeRelativeJsonPath(string rootPath, string relativePath, string paramName) {
        var normalized = NormalizeRelativePath(relativePath, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException("Relative path is required.", paramName);

        var segments = normalized.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            throw new ArgumentException("Relative path is required.", paramName);

        var fileSegment = segments[^1];
        var extension = Path.GetExtension(fileSegment);
        if (!string.IsNullOrEmpty(extension) && !extension.Equals(".json", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException(
                $"Unsupported extension '{extension}'. Use .json or omit extension.",
                paramName
            );

        var normalizedFileName = string.IsNullOrEmpty(extension)
            ? fileSegment
            : Path.GetFileNameWithoutExtension(fileSegment);
        if (string.IsNullOrWhiteSpace(normalizedFileName))
            throw new ArgumentException("Relative path must include a file name.", paramName);

        var directorySegments = segments.Take(segments.Length - 1);
        var safeRelativeWithExtension = directorySegments
            .Append($"{normalizedFileName}.json")
            .JoinWith(Path.DirectorySeparatorChar);

        var combined = Path.GetFullPath(Path.Combine(rootPath, safeRelativeWithExtension));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string NormalizeRelativePath(string? input, string paramName) {
        if (string.IsNullOrWhiteSpace(input))
            return string.Empty;

        var normalized = input.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var segments = normalized.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            return string.Empty;

        var invalidSegment = segments.FirstOrDefault(segment =>
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (!string.IsNullOrWhiteSpace(invalidSegment))
            throw new ArgumentException(
                $"Invalid relative path segment '{invalidSegment}'.",
                paramName
            );

        return segments.JoinWith('/');
    }

    public static HashSet<string> NormalizeAllowedRoots(IEnumerable<string>? allowedRoots) =>
        (allowedRoots ?? [])
        .Where(rootName => !string.IsNullOrWhiteSpace(rootName))
        .Select(rootName => rootName.Replace('\\', '/').Trim('/'))
        .Where(rootName => !string.IsNullOrWhiteSpace(rootName))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static ResolvedDirective ResolveDirectivePath(
        string directivePath,
        string localRootDirectory,
        string? globalRootDirectory,
        IEnumerable<string>? allowedRoots,
        string paramName,
        bool requireGlobalAllowedRoot
    ) {
        if (string.IsNullOrWhiteSpace(directivePath))
            throw new ArgumentException("Directive path is required.", paramName);

        var normalizedAllowedRoots = NormalizeAllowedRoots(allowedRoots);
        var isGlobalDirective = directivePath.StartsWith("@global/", StringComparison.OrdinalIgnoreCase);
        var isLocalDirective = directivePath.StartsWith("@local/", StringComparison.OrdinalIgnoreCase);
        if (!isGlobalDirective && !isLocalDirective)
            throw new ArgumentException("Directive path must start with '@local/' or '@global/'.", paramName);

        var rawRelativePath = isGlobalDirective
            ? directivePath["@global/".Length..]
            : directivePath["@local/".Length..];
        if (string.IsNullOrWhiteSpace(rawRelativePath))
            throw new ArgumentException("Directive path must include a relative file path.", paramName);
        if (Path.IsPathRooted(rawRelativePath))
            throw new ArgumentException("Directive path must be relative.", paramName);

        var normalizedRelativePath = NormalizeRelativePath(rawRelativePath, paramName);
        if (string.IsNullOrWhiteSpace(normalizedRelativePath))
            throw new ArgumentException("Directive path must include a relative file path.", paramName);

        var segments = normalizedRelativePath.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
        var rootSegment = segments.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(rootSegment))
            throw new ArgumentException("Directive path must include a valid root segment.", paramName);

        var hasAllowedRoot = normalizedAllowedRoots.Contains(rootSegment);
        if (normalizedAllowedRoots.Count != 0 && !hasAllowedRoot)
            throw new ArgumentException($"Directive root '{rootSegment}' is not allowed.", paramName);
        if (isGlobalDirective && normalizedAllowedRoots.Count == 0 && requireGlobalAllowedRoot)
            throw new ArgumentException("Global directives require an allowed root.", paramName);

        var targetRootDirectory = isGlobalDirective
            ? Path.GetFullPath(globalRootDirectory ??
                               throw new ArgumentException(
                                   "Global directives require a global root directory.",
                                   paramName
                               ))
            : Path.GetFullPath(localRootDirectory);
        var scope = isGlobalDirective ? DirectiveScope.Global : DirectiveScope.Local;

        return new ResolvedDirective(
            directivePath,
            scope,
            normalizedRelativePath,
            rootSegment,
            targetRootDirectory
        );
    }

    public static DirectiveFileCandidates ResolveDirectiveFileCandidates(
        ResolvedDirective directive,
        bool allowToonFallback
    ) {
        var normalizedPath = directive.RelativePath.Replace('/', Path.DirectorySeparatorChar);
        var hasJsonExtension = directive.RelativePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
        var hasToonExtension = directive.RelativePath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase);
        var jsonPath = hasJsonExtension
            ? Path.GetFullPath(Path.Combine(directive.RootDirectory, normalizedPath))
            : Path.GetFullPath(Path.Combine(directive.RootDirectory, normalizedPath + ".json"));
        EnsurePathUnderRoot(jsonPath, directive.RootDirectory, nameof(directive));

        string? toonPath = null;
        if (allowToonFallback && !hasJsonExtension) {
            toonPath = hasToonExtension
                ? Path.GetFullPath(Path.Combine(directive.RootDirectory, normalizedPath))
                : Path.GetFullPath(Path.Combine(directive.RootDirectory, normalizedPath + ".toon"));
            EnsurePathUnderRoot(toonPath, directive.RootDirectory, nameof(directive));
        }

        return new DirectiveFileCandidates(jsonPath, toonPath);
    }

    public static void EnsurePathUnderRoot(string candidatePath, string rootPath, string paramName) {
        var normalizedRoot = Path.GetFullPath(rootPath)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normalizedCandidate = Path.GetFullPath(candidatePath)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var rootPrefix = normalizedRoot + Path.DirectorySeparatorChar;

        var isUnderRoot = normalizedCandidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) ||
                          string.Equals(normalizedCandidate, normalizedRoot, StringComparison.OrdinalIgnoreCase);
        if (!isUnderRoot)
            throw new ArgumentException("Resolved path escapes the settings root.", paramName);
    }

    /// <summary>
    ///     Attempts to resolve the shared global fragments directory for a settings root.
    ///     Expected storage shape: {BasePath}/{Addin}/settings and {BasePath}/Global/fragments.
    /// </summary>
    public static string? TryResolveGlobalFragmentsDirectory(string settingsRootPath) {
        var normalizedRoot = Path.GetFullPath(settingsRootPath);
        var rootName = Path.GetFileName(
            normalizedRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));

        if (string.Equals(rootName, "Global", StringComparison.OrdinalIgnoreCase))
            return Path.Combine(normalizedRoot, "fragments");

        DirectoryInfo? settingsDirectory = null;
        if (string.Equals(rootName, "settings", StringComparison.OrdinalIgnoreCase)) {
            settingsDirectory = new DirectoryInfo(normalizedRoot);
        } else {
            var current = new DirectoryInfo(normalizedRoot);
            while (current != null) {
                if (string.Equals(current.Name, "settings", StringComparison.OrdinalIgnoreCase)) {
                    settingsDirectory = current;
                    break;
                }
                current = current.Parent;
            }
        }

        // If no settings ancestor exists, do not guess.
        if (settingsDirectory == null)
            return null;

        var addinDirectory = settingsDirectory.Parent;
        var baseDirectory = addinDirectory?.Parent;
        if (baseDirectory == null)
            return null;

        return Path.Combine(baseDirectory.FullName, "Global", "fragments");
    }

    private static (string BaseDirectory, string Namespace) TryResolveStorageBaseAndNamespace(string contextDirectory) {
        var current = new DirectoryInfo(contextDirectory);
        while (current != null) {
            if (string.Equals(current.Name, "Global", StringComparison.OrdinalIgnoreCase)) {
                var baseDirectory = current.Parent?.FullName;
                if (!string.IsNullOrWhiteSpace(baseDirectory))
                    return (baseDirectory, GlobalSchemaNamespace);
                break;
            }
            current = current.Parent;
        }

        var settingsAncestor = FindNamedAncestor(contextDirectory, "settings");
        if (settingsAncestor != null) {
            var addinDirectory = settingsAncestor.Parent;
            var baseDirectory = addinDirectory?.Parent;
            if (addinDirectory != null && baseDirectory != null)
                return (baseDirectory.FullName, NormalizeSchemaKey(addinDirectory.Name));
        }

        var stateAncestor = FindNamedAncestor(contextDirectory, "state");
        if (stateAncestor != null) {
            var addinDirectory = stateAncestor.Parent;
            var baseDirectory = addinDirectory?.Parent;
            if (addinDirectory != null && baseDirectory != null)
                return (baseDirectory.FullName, NormalizeSchemaKey(addinDirectory.Name));
        }

        var fallbackBaseDirectory = Directory.GetParent(contextDirectory)?.FullName ?? contextDirectory;
        var fallbackNamespace = new DirectoryInfo(contextDirectory).Name;
        return (fallbackBaseDirectory, NormalizeSchemaKey(fallbackNamespace));
    }

    private static DirectoryInfo? FindNamedAncestor(string path, string ancestorName) {
        var current = new DirectoryInfo(path);
        while (current != null) {
            if (string.Equals(current.Name, ancestorName, StringComparison.OrdinalIgnoreCase))
                return current;
            current = current.Parent;
        }

        return null;
    }

    private static string NormalizeSchemaKey(string rawKey) {
        var normalized = rawKey
            .Replace('\\', '-')
            .Replace('/', '-')
            .Replace('.', '-')
            .Replace('+', '-')
            .Trim();
        var compacted = new string(normalized
            .Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '-' : character)
            .ToArray());
        while (compacted.Contains("--", StringComparison.Ordinal))
            compacted = compacted.Replace("--", "-");
        return compacted.Trim('-').ToLowerInvariant();
    }

    private static string BuildProfileTypeSchemaKey(Type type) {
        if (!type.IsGenericType)
            return NormalizeSchemaKey(type.FullName ?? type.Name);

        var genericDefinition = type.GetGenericTypeDefinition();
        var genericDefinitionName = genericDefinition.FullName ?? genericDefinition.Name;
        var genericBaseName = genericDefinitionName.Split('`')[0];
        var genericArgumentKeys = type.GetGenericArguments()
            .Select(BuildProfileTypeSchemaKey)
            .ToArray();
        var combined = $"{genericBaseName}-{string.Join("-", genericArgumentKeys)}";
        return NormalizeSchemaKey(combined);
    }
}

public static class SettingsDiscoveryBuilder {
    public static SettingsFileEntry CreateSettingsFileEntry(string absoluteFilePath, string settingsRootPath) {
        var fileInfo = new FileInfo(absoluteFilePath);
        var relativePath = BclExtensions.GetRelativePath(settingsRootPath, absoluteFilePath).Replace('\\', '/');
        var relativePathWithoutExtension = Path.ChangeExtension(relativePath, null) ?? relativePath;
        var normalizedDirectory = Path.GetDirectoryName(relativePath)?.Replace('\\', '/');
        var relativeSegments = relativePath.SplitAndTrim(
            '/',
            StringSplitOptions.RemoveEmptyEntries | (StringSplitOptions)2 /* TrimEntries, polyfill for net48 */);
        var isSchema = fileInfo.Name.EndsWith(".schema.json", StringComparison.OrdinalIgnoreCase) ||
                       fileInfo.Name.Equals("schema.json", StringComparison.OrdinalIgnoreCase);
        var isFragmentDirectory = relativeSegments.Any(segment =>
            segment.StartsWith("_", StringComparison.OrdinalIgnoreCase));
        var isFragment = isFragmentDirectory;
        var kind = isSchema
            ? SettingsFileKind.Schema
            : isFragment
                ? SettingsFileKind.Fragment
                : SettingsFileKind.Profile;

        return new SettingsFileEntry(
            fileInfo.FullName,
            relativePath,
            relativePathWithoutExtension,
            fileInfo.Name,
            Path.GetFileNameWithoutExtension(fileInfo.Name),
            string.IsNullOrWhiteSpace(normalizedDirectory) ? null : normalizedDirectory,
            new DateTimeOffset(fileInfo.LastWriteTimeUtc, TimeSpan.Zero),
            kind,
            isFragment,
            isSchema
        );
    }

    public static SettingsDirectoryNode BuildDirectoryTree(
        string rootName,
        string rootRelativePath,
        List<SettingsFileEntry> files
    ) {
        var root = new SettingsDirectoryNode(rootName, rootRelativePath, [], []);
        foreach (var file in files) {
            var localRelativePath = GetLocalRelativePath(file.RelativePath, rootRelativePath);
            var localSegments = localRelativePath.SplitAndTrim('/', StringSplitOptions.RemoveEmptyEntries);
            if (localSegments.Length == 0)
                continue;

            var fileName = localSegments[^1];
            var directorySegments = localSegments.Take(localSegments.Length - 1);
            var current = root;
            var currentRelative = rootRelativePath;
            foreach (var segment in directorySegments) {
                currentRelative = string.IsNullOrWhiteSpace(currentRelative)
                    ? segment
                    : $"{currentRelative}/{segment}";
                var existing = current.Directories.FirstOrDefault(d =>
                    string.Equals(d.Name, segment, StringComparison.OrdinalIgnoreCase));
                if (existing == null) {
                    existing = new SettingsDirectoryNode(segment, currentRelative, [], []);
                    current.Directories.Add(existing);
                }

                current = existing;
            }

            current.Files.Add(new SettingsFileNode(
                fileName,
                file.RelativePath,
                file.RelativePathWithoutExtension,
                file.RelativePathWithoutExtension,
                file.ModifiedUtc,
                file.Kind,
                file.IsFragment,
                file.IsSchema
            ));
        }

        SortTree(root);
        return root;
    }

    private static string GetLocalRelativePath(string fileRelativePath, string rootRelativePath) {
        if (string.IsNullOrWhiteSpace(rootRelativePath))
            return fileRelativePath;

        var prefix = $"{rootRelativePath.TrimEnd('/')}/";
        if (fileRelativePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return fileRelativePath[prefix.Length..];
        if (string.Equals(fileRelativePath, rootRelativePath, StringComparison.OrdinalIgnoreCase))
            return Path.GetFileName(fileRelativePath);

        return fileRelativePath;
    }

    private static void SortTree(SettingsDirectoryNode node) {
        node.Directories.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));
        node.Files.Sort((left, right) => string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase));

        foreach (var directory in node.Directories)
            SortTree(directory);
    }
}
