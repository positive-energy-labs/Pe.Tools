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

public sealed record ScriptCompilationResult(
    bool Success,
    byte[]? AssemblyBytes,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
);
