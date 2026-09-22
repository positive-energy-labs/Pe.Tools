namespace Pe.Shared.RevitData.Families;

/// <summary>Serializable execution behavior authored beside a Family Foundry profile.</summary>
public sealed class ExecutionOptions {
    /// <summary>Bundle lowered native operations into one edit transaction inside the whole-family rollback group.</summary>
    public bool SingleTransaction { get; init; } = true;

    /// <summary>Batch consecutive type operations.</summary>
    public bool OptimizeTypeOperations { get; init; } = true;

    /// <summary>Enable an optional processor snapshot pipeline when the caller supplies one.</summary>
    public bool EnableCollectors { get; init; } = true;

    /// <summary>Suppress non-fatal Revit warnings while retaining commit diagnostics.</summary>
    public bool SuppressWarnings { get; init; }

    /// <summary>Capture the parameter dependency graph per family before the operations run and emit it as a diagnostic (up to ~1 s on a large family). Off by default.</summary>
    public bool CaptureDependencyGraph { get; init; }
}
