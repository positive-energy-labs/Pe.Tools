using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Execution;

public sealed record ScriptSourceFile(
    string Name,
    string Content,
    string? FullPath = null
);

public sealed record ScriptSourceSet(
    IReadOnlyList<ScriptSourceFile> Files,
    string EntryPointSourceName
);

/// <summary>The bound on a run's `Input`: one JSON object, at most 256 KiB as compact UTF-8.</summary>
public static class ScriptInputBounds {
    public const int MaxInputBytes = 256 * 1024;

    public static void Require(Newtonsoft.Json.Linq.JObject? input) {
        if (input is not null && System.Text.Encoding.UTF8.GetByteCount(input.ToString(Newtonsoft.Json.Formatting.None)) > MaxInputBytes)
            throw new ArgumentException("Script input may not exceed 256 KiB.");
    }
}

public sealed record ScriptCompilationResult(
    bool Success,
    byte[]? AssemblyBytes,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);
