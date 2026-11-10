namespace Pe.Shared.Product;

/// <summary>
///     The product's path rules (ADR 0035 rule 11): two content homes and the machine state root. The
///     user root always exists and takes every write; the optional shared root follows it in read order.
///     The TS twin is host-contracts product-paths.ts / service-identity.ts; all assert runtime-ownership.fixture.json.
/// </summary>
public static class ProductPathing {
    /// <summary>
    ///     The state root for a runtime its shell was told about: <c>&lt;home&gt;\.local-state</c> under a
    ///     product home override (an isolated run shares no state with the owner's host), else the dev
    ///     checkout's <c>.artifacts\pe-tools</c>, else the SDK install root itself. Machine state never lands
    ///     at or under a content home's share: the shared root, or (without an override) the Documents user root.
    /// </summary>
    public static string StateRoot(ProductLane lane, string ownerRoot, string? productHome, string? sharedRoot = null, string? userRoot = null) {
        if (!Path.IsPathRooted(ownerRoot))
            throw new ArgumentException($"A {lane} runtime needs an absolute owner root.", nameof(ownerRoot));
        if (lane == ProductLane.Installed && !string.IsNullOrWhiteSpace(productHome))
            throw new ArgumentException($"An installed runtime does not run under {ProductPathNames.ProductHomeVariable}; unset it, or use a dev session.", nameof(productHome));
        var overridden = !string.IsNullOrWhiteSpace(productHome);
        var stateOwner = Path.GetFullPath(overridden ? productHome!.Trim() : ownerRoot);
        // Installed is the SDK's install root verbatim: byte-identical to v0.7.30's LocalApplicationData formula.
        var root = overridden ? Path.Combine(stateOwner, ProductPathNames.LocalStateDirectoryName)
            : lane == ProductLane.Dev ? Path.Combine(stateOwner, ".artifacts", "pe-tools") : ownerRoot;
        // An override's .local-state sits in its own home by design (an isolated run); only the default user root is a share.
        foreach (var (fence, name) in new[] { (sharedRoot, ProductPathNames.SharedRootVariable), (overridden ? null : userRoot, "the user content root") }) {
            if (string.IsNullOrWhiteSpace(fence)) continue;
            var home = Path.GetFullPath(fence!.Trim());
            if (IsAtOrUnder(root, home))
                throw new ArgumentException($"Machine state root '{root}' cannot be at or under {name} '{home}'.");
        }
        return root;
    }

    /// <summary>The user's content root: an explicit path, else <see cref="ProductPathNames.ProductHomeVariable" />, else <see cref="DocumentsUserRoot" />.</summary>
    public static string UserRoot(string? productHome = null) {
        var explicitHome = string.IsNullOrWhiteSpace(productHome)
            ? Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable)
            : productHome;
        return string.IsNullOrWhiteSpace(explicitHome) ? DocumentsUserRoot : Path.GetFullPath(explicitHome!.Trim());
    }

    /// <summary><c>&lt;Documents&gt;\Pe.Tools</c> from the known folder (OneDrive when it redirects Documents), ignoring any override.</summary>
    public static string DocumentsUserRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), ProductIdentity.ProductName);

    /// <summary>The optional shared content root; null when <see cref="ProductPathNames.SharedRootVariable" /> is unset.</summary>
    public static string? SharedRoot() {
        var shared = Environment.GetEnvironmentVariable(ProductPathNames.SharedRootVariable);
        return string.IsNullOrWhiteSpace(shared) ? null : Path.GetFullPath(shared!.Trim());
    }

    /// <summary>The read order: user first, so an item in both homes resolves to the user's copy.</summary>
    public static IReadOnlyList<string> ContentHomes() =>
        SharedRoot() is { } shared ? new[] { UserRoot(), shared } : new[] { UserRoot() };

    /// <summary>The firm files' folder, <c>&lt;shared&gt;\Firm</c>; null without a shared root.</summary>
    public static string? SharedFirmDir() => SharedRoot() is { } shared ? Path.Combine(shared, "Firm") : null;

    /// <summary>The shared keys file, <c>&lt;shared&gt;\keys.json</c>; null without a shared root.</summary>
    public static string? SharedKeysPath() => SharedRoot() is { } shared ? Path.Combine(shared, "keys.json") : null;

    private static bool IsAtOrUnder(string path, string root) =>
        (Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar)
        .StartsWith(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

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
