namespace Pe.Shared.HostContracts.Scripting;

/// <summary>
///     Bounds on one captured pod source. C# validates bundles against them; the generated contract
///     carries them as `scriptPodSourceBounds` so the host capture reads the same numbers.
/// </summary>
public static class ScriptPodSourceBounds {
    public const int MaxFileBytes = 512 * 1024;
    public const int MaxTotalBytes = 4 * 1024 * 1024;
    public const int MaxFileCount = 200;
    public const int MaxDirectoryCount = 256;
}
