using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Pe.Shared.Product;

internal static class ProductPathing {
    /// <summary>
    ///     The machine-local product root: an explicit <c>%LOCALAPPDATA%</c>, else
    ///     <c>&lt;product home&gt;\.local-state</c> when <see cref="ProductPathNames.ProductHomeVariable" /> is set
    ///     (an isolated run shares no state with the owner's host), else <c>%LOCALAPPDATA%\Vendor\Product</c>.
    ///     Host lanes mirror ts/packages/host-contracts/src/service-identity.ts productRoot:
    ///     dev uses checkout/.artifacts/pe-tools or the home override, never installed state.
    /// </summary>
    public static string ResolveRuntimeRoot(string? localAppData, string lane = "installed", string? sourceRoot = null) {
        if (lane != "installed" && lane != "dev")
            throw new ArgumentException("A runtime requires a dev or installed lane.", nameof(lane));
        if (lane == "dev") {
            if (string.IsNullOrWhiteSpace(sourceRoot))
                throw new ArgumentException("A dev state root requires a Pe.Tools checkout.", nameof(sourceRoot));
            var checkout = Path.GetFullPath(sourceRoot!);
            if ((!File.Exists(Path.Combine(checkout, ".git")) && !Directory.Exists(Path.Combine(checkout, ".git"))) ||
                !File.Exists(Path.Combine(checkout, "Pe.Tools.slnx")))
                throw new ArgumentException("A dev state root requires a Pe.Tools checkout.", nameof(sourceRoot));
            var root = string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable))
                ? Path.Combine(checkout, ".artifacts", "pe-tools")
                : Path.Combine(ResolveProductHome(null), ProductPathNames.LocalStateDirectoryName);
            var installed = CanonicalPath(InstalledRuntimeRoot(localAppData)).TrimEnd(Path.DirectorySeparatorChar);
            var candidate = CanonicalPath(root).TrimEnd(Path.DirectorySeparatorChar);
            if (candidate.Equals(installed, StringComparison.OrdinalIgnoreCase) ||
                candidate.StartsWith(installed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Dev host cannot use installed product state '{root}'.");
            return root;
        }
        if (string.IsNullOrWhiteSpace(localAppData) &&
            !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable)))
            return Path.Combine(ResolveProductHome(null), ProductPathNames.LocalStateDirectoryName);
        return InstalledRuntimeRoot(localAppData);
    }

    private static string InstalledRuntimeRoot(string? localAppData) {
        if (string.IsNullOrWhiteSpace(localAppData)) localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        var local = string.IsNullOrWhiteSpace(localAppData)
            ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            : Path.GetFullPath(localAppData);
        return Path.Combine(local, ProductIdentity.VendorName, ProductIdentity.ProductName);
    }

    // Like TS realpath on the nearest existing ancestor, including junctions; net48 has no ResolveLinkTarget.
    private static string CanonicalPath(string path) {
        path = Path.GetFullPath(path);
        if (!Directory.Exists(path) && !File.Exists(path)) {
            var parent = Path.GetDirectoryName(path);
            return parent == null ? path : Path.Combine(CanonicalPath(parent), Path.GetFileName(path));
        }
        // Follow links without data access; share reads/writes/deletes and allow directory handles.
        using var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var buffer = new StringBuilder(32768);
        var length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
        var result = buffer.ToString();
        return result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase) ? @"\\" + result.Substring(8)
            : result.StartsWith(@"\\?\", StringComparison.Ordinal) ? result.Substring(4) : result;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);

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
