namespace Pe.Shared.StorageRuntime;

/// <summary>
///     Shared helpers for safe settings path resolution and settings discovery projections.
/// </summary>
public static class SettingsPathing {
    public enum DirectiveScope {
        Local,
        Global
    }

    private const string GlobalSchemaNamespace = "global";

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
            : NormalizeSchemaKey(namespaceOverride!);

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

        var segments = SplitAndTrim(normalized!, '/');
        if (segments.Length == 0)
            throw new ArgumentException("Relative path is required.", paramName);

        var fileSegment = segments[^1];
        var extension = Path.GetExtension(fileSegment);
        if (!string.IsNullOrEmpty(extension) && !extension.Equals(".json", StringComparison.OrdinalIgnoreCase)) {
            throw new ArgumentException(
                $"Unsupported extension '{extension}'. Use .json or omit extension.",
                paramName
            );
        }

        var normalizedFileName = string.IsNullOrEmpty(extension)
            ? fileSegment
            : Path.GetFileNameWithoutExtension(fileSegment);
        if (string.IsNullOrWhiteSpace(normalizedFileName))
            throw new ArgumentException("Relative path must include a file name.", paramName);

        var directorySegments = segments.Take(segments.Length - 1);
        var safeRelativeWithExtension = string.Join(
            Path.DirectorySeparatorChar.ToString(),
            directorySegments.Append($"{normalizedFileName}.json")
        );

        var combined = Path.GetFullPath(Path.Combine(rootPath, safeRelativeWithExtension));
        EnsurePathUnderRoot(combined, rootPath, paramName);
        return combined;
    }

    public static string NormalizeRelativePath(string? input, string paramName) {
        var normalized = input?.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var segments = SplitAndTrim(normalized!, '/');
        if (segments.Length == 0)
            return string.Empty;

        var invalidSegment = segments.FirstOrDefault(segment =>
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (!string.IsNullOrWhiteSpace(invalidSegment)) {
            throw new ArgumentException(
                $"Invalid relative path segment '{invalidSegment}'.",
                paramName
            );
        }

        return string.Join("/", segments);
    }

    public static HashSet<string> NormalizeAllowedRoots(IEnumerable<string>? allowedRoots) =>
        new(
            (allowedRoots ?? [])
            .Where(rootName => !string.IsNullOrWhiteSpace(rootName))
            .Select(rootName => rootName.Replace('\\', '/').Trim('/'))
            .Where(rootName => !string.IsNullOrWhiteSpace(rootName)),
            StringComparer.OrdinalIgnoreCase
        );

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

        var segments = SplitAndTrim(normalizedRelativePath, '/');
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
    ///     Expected storage shape: {BasePath}/{Module}/{Root} and {BasePath}/Global/fragments.
    /// </summary>
    public static string? TryResolveGlobalFragmentsDirectory(string settingsRootPath) {
        var normalizedRoot = Path.GetFullPath(settingsRootPath);
        var globalAncestor = FindNamedAncestor(normalizedRoot, "Global");
        if (globalAncestor?.Parent != null)
            return Path.Combine(globalAncestor.FullName, "fragments");

        var settingsDirectory = FindNamedAncestor(normalizedRoot, "settings");
        if (settingsDirectory == null)
            return null;

        return Path.Combine(settingsDirectory.FullName, "Global", "fragments");
    }

    private static (string BaseDirectory, string Namespace) TryResolveStorageBaseAndNamespace(string contextDirectory) {
        var current = new DirectoryInfo(contextDirectory);
        while (current != null) {
            if (string.Equals(current.Name, "Global", StringComparison.OrdinalIgnoreCase)) {
                if (current.Parent?.FullName is { } baseDirectory)
                    return (baseDirectory, GlobalSchemaNamespace);

                break;
            }

            current = current.Parent;
        }

        var settingsAncestor = FindNamedAncestor(contextDirectory, "settings");
        if (settingsAncestor != null) {
            var moduleDirectory = FindDirectChildUnderAncestor(contextDirectory, settingsAncestor);
            if (moduleDirectory != null)
                return (settingsAncestor.FullName, NormalizeSchemaKey(moduleDirectory.Name));
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

    private static DirectoryInfo? FindDirectChildUnderAncestor(string path, DirectoryInfo ancestor) {
        var current = new DirectoryInfo(path);
        DirectoryInfo? child = null;
        while (current != null) {
            if (string.Equals(current.FullName, ancestor.FullName, StringComparison.OrdinalIgnoreCase))
                return child;

            child = current;
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
        while (compacted.IndexOf("--", StringComparison.Ordinal) >= 0)
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

    private static string[] SplitAndTrim(string value, char separator) =>
        value
            .Split([separator], StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => segment.Trim())
            .Where(segment => !string.IsNullOrWhiteSpace(segment))
            .ToArray();

    public readonly record struct ResolvedDirective(
        string OriginalPath,
        DirectiveScope Scope,
        string RelativePath,
        string RootSegment,
        string RootDirectory
    );

    public readonly record struct DirectiveFileCandidates(string JsonPath, string? ToonPath);
}