using System.Text.RegularExpressions;

namespace Pe.Shared.Product;

/// <summary>The tier a home's marker proves (homes freeze shape 1).</summary>
public enum HomeTier { User, Project, Firm }

/// <summary>
///     The resolved homes. <see cref="List" /> is the read order <c>[user, project, firm]</c>. Project is null for
///     an unbound model and firm for a machine with no firm home; both must work.
/// </summary>
public sealed record ProductHomes(string User, string? Project, string? Firm, string? SharedDriveRoot) {
    public IReadOnlyList<string> List => new[] { this.User, this.Project, this.Firm }.OfType<string>().ToList();
    public string? FirmSettingsDir => this.Firm is null ? null : Path.Combine(this.Firm, ProductPathNames.HomeSettingsDirectoryName);
    public string? FirmPreferencesPath => this.FirmSettingsDir is null ? null : Path.Combine(this.FirmSettingsDir, ProductPathNames.PreferencesFileName);
    public string? FirmKeysPath => this.Firm is null ? null : Path.Combine(this.Firm, ProductPathNames.KeysFileName);
}

/// <summary>
///     The product's path rules: the three content homes of ADR 0037 (user, project, firm) and the machine state
///     root. Only a project home requires a <c>pe-home.json</c> marker; the user home always exists.
///     The TS twin is host-contracts product-paths.ts / service-identity.ts; all assert runtime-ownership.fixture.json.
/// </summary>
public static class ProductPathing {
    /// <summary>
    ///     The state root for a runtime its shell was told about: <c>&lt;home&gt;\.local-state</c> under a
    ///     product home override (an isolated run shares no state with the owner's host), else the dev
    ///     checkout's <c>.artifacts\pe-tools</c>, else the SDK install root itself. Machine state never lands
    ///     at or under a content home's share: the <paramref name="sharedRoot" /> fence, or (without an override)
    ///     the Documents user root.
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

    /// <summary>
    ///     The user home: an explicit path, else <see cref="ProductPathNames.ProductHomeVariable" />, else the
    ///     <c>homes.json</c> choice, else <see cref="DocumentsUserRoot" />.
    /// </summary>
    public static string UserRoot(string? productHome = null) {
        var explicitHome = string.IsNullOrWhiteSpace(productHome) ? ToldHome(ProductPathNames.ProductHomeVariable, ChosenHomes().User) : productHome;
        return string.IsNullOrWhiteSpace(explicitHome) ? DocumentsUserRoot : Path.GetFullPath(explicitHome!.Trim());
    }

    // The environment override beats the file because it is the dev and test isolation switch: an isolated run
    // must never be redirected by the owner's real homes.json. TS toldHome reads the same order.
    private static string? ToldHome(string variable, string? chosen) =>
        Environment.GetEnvironmentVariable(variable) is { } told && !string.IsNullOrWhiteSpace(told) ? told : chosen;

    /// <summary>
    ///     This machine's <c>state\homes.json</c>, read only once the shell configured its runtime (an unconfigured
    ///     process has no state root to read it from) and on every call, so a Settings write applies at the next read.
    /// </summary>
    private static (string? Firm, string? User) ChosenHomes() {
        var path = ProductRuntimeLayout.Configured?.State.HomesConfigPath;
        try { return path is not null && File.Exists(path) ? HomesConfig(File.ReadAllText(path)) : (null, null); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { return (null, null); }
    }

    private static readonly Regex HomesConfigField = new(@"""(firm|user)""\s*:\s*""((?:[^""\\]|\\.)*)""", RegexOptions.CultureInvariant);

    /// <summary>
    ///     The two paths of a <c>homes.json</c> text (<c>{"firm"?: path, "user"?: path}</c>, absolute). Pure BCL, so a
    ///     field match rather than a JSON reader; a relative or empty value is no choice. The host validates on write.
    /// </summary>
    public static (string? Firm, string? User) HomesConfig(string? text) {
        string? Field(string name) => HomesConfigField.Matches(text ?? string.Empty).Cast<Match>()
            .Where(match => match.Groups[1].Value == name)
            .Select(match => Regex.Unescape(match.Groups[2].Value).Trim())
            .FirstOrDefault(value => value.Length > 0 && Path.IsPathRooted(value));
        return (Field("firm"), Field("user"));
    }

    /// <summary><c>&lt;Documents&gt;\Pe.Tools</c> from the known folder (OneDrive when it redirects Documents), ignoring any override.</summary>
    public static string DocumentsUserRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), ProductIdentity.ProductName);

    // "Tier and nothing else" (freeze shape 1) is a whole-text match, so a marker with a second field proves nothing.
    private static readonly Regex Marker = new(@"\A\s*\{\s*""tier""\s*:\s*""(user|project|firm)""\s*\}\s*\z", RegexOptions.CultureInvariant);

    /// <summary>The tier a <c>pe-home.json</c> proves; null when its text proves none. A byte order mark is not content.</summary>
    public static HomeTier? MarkerTier(string? text) =>
        Marker.Match((text ?? string.Empty).TrimStart('﻿')) is { Success: true } match
            ? match.Groups[1].Value switch { "user" => HomeTier.User, "project" => HomeTier.Project, _ => HomeTier.Firm }
            : null;

    /// <summary>This machine's homes, read from disk. <paramref name="pointer" /> is the open model's project-home path.</summary>
    public static ProductHomes Homes(string? pointer = null) => Homes(
        ToldHome(ProductPathNames.ProductHomeVariable, ChosenHomes().User),
        ToldHome(ProductPathNames.SharedRootVariable, ChosenHomes().Firm),
        Directory.Exists, MarkerText, pointer);

    /// <summary>Settings, else the literal default when present. Markers apply only to project homes.</summary>
    public static ProductHomes Homes(string? productHome, string? sharedRoot,
        Func<string, bool> exists, Func<string, string?> markerText, string? pointer) {
        var user = string.IsNullOrWhiteSpace(productHome) ? DocumentsUserRoot : Path.GetFullPath(productHome!.Trim());
        var candidate = string.IsNullOrWhiteSpace(sharedRoot) ? ProductPathNames.DefaultFirmHome : Path.GetFullPath(sharedRoot!.Trim());
        if (!exists(candidate)) return new ProductHomes(user, null, null, null);
        var sharedDriveRoot = Path.GetDirectoryName(Path.GetDirectoryName(candidate) ?? string.Empty);
        var project = ProjectHome(sharedDriveRoot, pointer);
        return new ProductHomes(user, project is not null && MarkerTier(markerText(project)) == HomeTier.Project ? project : null,
            candidate, sharedDriveRoot);
    }

    // The stored pointer is a forward-slash path relative to the shared drive root, with no drive letter (freeze shape 4).
    private static string? ProjectHome(string? sharedDriveRoot, string? pointer) {
        if (string.IsNullOrEmpty(sharedDriveRoot) || string.IsNullOrWhiteSpace(pointer)) return null;
        var segments = pointer!.Split('/');
        return segments.Any(segment => segment.Trim().Length == 0 || segment is "." or ".."
                || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            ? null
            : Path.Combine(new[] { sharedDriveRoot! }.Concat(segments).Concat(new[] { ProductIdentity.ProductName }).ToArray());
    }

    private static string? MarkerText(string home) {
        var marker = Path.Combine(home, ProductPathNames.HomeMarkerFileName);
        try { return File.Exists(marker) ? File.ReadAllText(marker) : null; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { return null; }
    }

    private static bool IsAtOrUnder(string path, string root) =>
        (Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar)
        .StartsWith(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    ///     The machine's installed namespace by the SDK/MSI rule (InstalledProduct.AppBaseFor). Never an
    ///     owner: Pe.App takes the installed root from the SDK. Read only to refuse dev state inside it.
    /// </summary>
    public static string InstalledNamespace => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ProductIdentity.VendorName, ProductIdentity.ProductName);

    /// <summary>The one import an authored <c>PeScripts.csproj</c> carries, spelled the same on every machine (homes freeze shape 8).</summary>
    public const string MachinePropsImport = @"$(LOCALAPPDATA)\" + ProductIdentity.VendorName + @"\" + ScriptingWorkspaceLayout.MachinePropsFileName;

    /// <summary>
    ///     Where bootstrap writes the machine's Revit and Pe assembly paths: outside every home, so the authored
    ///     project is byte-identical across machines, and outside the installed root, which dev state may not enter.
    /// </summary>
    // ponytail: one file per OS user, shared by the installed lane, every dev checkout, every isolated home and
    // every Revit year, so the last bootstrap wins and an editor resolves that session's assemblies. The import
    // carries no Exists condition: a machine that never bootstrapped fails the offline build loudly. Key the
    // file only if two of those must build pods at once; the import is one frozen spelling, so the keying has
    // to live inside the props file (a Condition on an environment variable the build is started with).
    // The import reads $(LOCALAPPDATA), which MSBuild takes from the environment variable, so the writer reads
    // that same variable first. The known folder ignores the variable: under a redirected or sandbox-set
    // LOCALAPPDATA it names a different file, and the build would import a missing or stale one (census R3).
    // This is the one environment read of that root; the state root stays on the SDK's word (InstalledNamespace).
    public static string MachinePropsPath => Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") is { } local && !string.IsNullOrWhiteSpace(local)
            ? local
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ProductIdentity.VendorName, ScriptingWorkspaceLayout.MachinePropsFileName);

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
