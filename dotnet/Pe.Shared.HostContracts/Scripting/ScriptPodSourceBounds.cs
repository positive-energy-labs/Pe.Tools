namespace Pe.Shared.HostContracts.Scripting;

/// <summary>
///     Bounds on the C# files the compiler reads, excluding manifest and project metadata.
/// </summary>
public static class ScriptPodSourceBounds {
    public const int MaxFileBytes = 512 * 1024;
    public const int MaxTotalBytes = 4 * 1024 * 1024;
    public const int MaxFileCount = 200;
    public const int MaxDirectoryCount = 256;
}

/// <summary>One Pod membership policy for admission, transport, and native member decoding.</summary>
public static class ScriptPodMemberBounds {
    public const int MaxFileBytes = 64 * 1024 * 1024;
    public const int MaxTotalBytes = 256 * 1024 * 1024;
    public const int MaxFileCount = 4096;
    public const int MaxDirectoryCount = 4096;
}
