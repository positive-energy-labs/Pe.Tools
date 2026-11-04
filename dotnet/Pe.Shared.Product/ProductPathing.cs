namespace Pe.Shared.Product;

internal static class ProductPathing {
    /// <summary>
    ///     The state root for a runtime its shell was told about: <c>&lt;home&gt;\.local-state</c> under a
    ///     product home override (an isolated run shares no state with the owner's host), else the dev
    ///     checkout's <c>.artifacts\pe-tools</c>, else the SDK install root itself. Pure: the TS twin
    ///     is <c>stateRoot</c> in service-identity.ts, and both assert runtime-ownership.fixture.json.
    /// </summary>
    public static string StateRoot(ProductLane lane, string ownerRoot, string? productHome) {
        if (!Path.IsPathRooted(ownerRoot))
            throw new ArgumentException($"A {lane} runtime needs an absolute owner root.", nameof(ownerRoot));
        // v0.7.30 refused an installed payload under a home override (its root check failed); kept unchanged.
        if (lane == ProductLane.Installed && !string.IsNullOrWhiteSpace(productHome))
            throw new ArgumentException($"An installed runtime does not run under {ProductPathNames.ProductHomeVariable}; unset it, or use a dev session.", nameof(productHome));
        if (!string.IsNullOrWhiteSpace(productHome))
            return Path.Combine(Path.GetFullPath(productHome!.Trim()), ProductPathNames.LocalStateDirectoryName);
        // Installed is the SDK's install root verbatim: byte-identical to v0.7.30's LocalApplicationData formula.
        return lane == ProductLane.Dev ? Path.Combine(Path.GetFullPath(ownerRoot), ".artifacts", "pe-tools") : ownerRoot;
    }

    /// <summary>
    ///     The machine's installed namespace by the SDK/MSI rule (InstalledProduct.AppBaseFor). Never an
    ///     owner: Pe.App takes the installed root from the SDK. Read only to refuse dev state inside it.
    /// </summary>
    public static string InstalledNamespace => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ProductIdentity.VendorName, ProductIdentity.ProductName);

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
