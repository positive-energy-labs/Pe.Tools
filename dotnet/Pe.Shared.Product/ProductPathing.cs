namespace Pe.Shared.Product;

internal static class ProductPathing {
    /// <summary>
    ///     The machine-local product root: an explicit <c>%LOCALAPPDATA%</c>, else
    ///     <c>&lt;product home&gt;\.local-state</c> when <see cref="ProductPathNames.ProductHomeVariable" /> is set
    ///     (an isolated run shares no state with the owner's host), else <c>%LOCALAPPDATA%\Vendor\Product</c>.
    ///     The host's <c>productRoot</c> resolves the same way.
    /// </summary>
    public static string ResolveRuntimeRoot(string? localAppData) {
        if (string.IsNullOrWhiteSpace(localAppData) &&
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable)))
            return Path.Combine(ResolveProductHome(null), ProductPathNames.LocalStateDirectoryName);
        var local = string.IsNullOrWhiteSpace(localAppData)
            ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            : Path.GetFullPath(localAppData);
        return Path.Combine(local, ProductIdentity.VendorName, ProductIdentity.ProductName);
    }

    public static string ResolveApplicationData(string? applicationData) =>
        string.IsNullOrWhiteSpace(applicationData)
            ? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)
            : Path.GetFullPath(applicationData);

    /// <summary>
    ///     The product home: an explicit path, else <see cref="ProductPathNames.ProductHomeVariable" />,
    ///     else <c>Documents\Pe.Tools</c>. The host's <c>productHomePath</c> resolves the same way.
    /// </summary>
    public static string ResolveProductHome(string? productHomePath) {
        var explicitHome = string.IsNullOrWhiteSpace(productHomePath)
            ? Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable)
            : productHomePath;
        return string.IsNullOrWhiteSpace(explicitHome)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), ProductIdentity.ProductName)
            : Path.GetFullPath(explicitHome.Trim());
    }

    public static string ResolveSafeSubDirectoryPath(string rootPath, string? subdirectory, string paramName) {
        var normalized = NormalizeRelativePath(subdirectory, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            return Path.GetFullPath(rootPath);

        var root = Path.GetFullPath(rootPath);
        var combined = Path.GetFullPath(Path.Combine(root, normalized.Replace('/', Path.DirectorySeparatorChar)));
        EnsurePathUnderRoot(combined, root, paramName);
        return combined;
    }

    public static string ResolveSafeRelativeFilePath(string rootPath, string relativePath, string paramName) {
        var normalized = NormalizeRelativePath(relativePath, paramName);
        if (string.IsNullOrWhiteSpace(normalized))
            throw new ArgumentException("Relative path is required.", paramName);

        var root = Path.GetFullPath(rootPath);
        var combined = Path.GetFullPath(Path.Combine(root, normalized.Replace('/', Path.DirectorySeparatorChar)));
        EnsurePathUnderRoot(combined, root, paramName);
        return combined;
    }

    public static string NormalizeRelativePath(string? input, string paramName) {
        if (Path.IsPathRooted(input ?? string.Empty))
            throw new ArgumentException("Rooted paths are not allowed.", paramName);

        var normalized = input?.Replace('\\', '/').Trim('/') ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => segment.Trim())
            .Where(segment => segment.Length > 0)
            .ToArray();
        var invalidSegment = segments.FirstOrDefault(segment =>
            segment == "." ||
            segment == ".." ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
        );
        if (!string.IsNullOrWhiteSpace(invalidSegment))
            throw new ArgumentException($"Invalid relative path segment '{invalidSegment}'.", paramName);

        return string.Join("/", segments);
    }

    private static void EnsurePathUnderRoot(string path, string rootPath, string paramName) {
        var normalizedRoot = Path.GetFullPath(rootPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalizedPath = Path.GetFullPath(path);
        if (!normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Path escapes the configured root.", paramName);
    }
}
