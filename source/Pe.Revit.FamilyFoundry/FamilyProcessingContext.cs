using Pe.Revit.Global;

namespace Pe.Revit.FamilyFoundry;

/// <summary>
///     Inter-operation state container for coordinating log entries across operations within an OperationGroup.
///     Created by OperationGroup, reset per-family by the OperationProcessor to ensure clean state.
/// </summary>
public class OperationContext {
    private readonly Dictionary<string, LogEntry> _entries = new();
    private readonly HashSet<string> _touchedThisOperation = [];
    private readonly List<LogEntry> _snapshots = [];
    public IEnumerable<LogEntry> All => this._entries.Values;

    /// <summary>
    ///     Initializes a log entry with the given key. Called by OperationGroup during construction.
    /// </summary>
    internal void InitializeEntry(string key) {
        if (!this._entries.ContainsKey(key))
            this._entries[key] = new LogEntry(key);
    }

    public Dictionary<string, LogEntry> GetAllInComplete() {
        var incomplete = this._entries
            .Where(e => !e.Value.IsComplete)
            .ToDictionary(e => e.Key, e => e.Value);

        // Mark all incomplete entries as touched so they appear in TakeSnapshot()
        foreach (var key in incomplete.Keys) _ = this._touchedThisOperation.Add(key);

        return incomplete;
    }

    /// <summary>
    ///     Gets a snapshot of logs touched by the current operation, then clears the touched set.
    ///     Clones LogEntry objects to prevent Context pollution from TypeOperations.
    ///     Clears messages from the original entries after cloning to prevent accumulation across types.
    /// </summary>
    public List<LogEntry> TakeSnapshot() {
        var snapshot = this._touchedThisOperation
            .Select(name => {
                var entry = this._entries[name];
                var clone = entry.Clone();
                // Clear messages from original entry to prevent accumulation across types
                entry.ClearMessages();
                return clone;
            })
            .ToList();
        this._touchedThisOperation.Clear();
        this._snapshots.AddRange(snapshot);
        return snapshot;
    }

    internal OperationLog Complete() {
        foreach (var entry in this._entries.Values.Where(e => !e.IsComplete)) {
            var attempts = this._snapshots.Where(s => ReferenceEquals(s.SnapshotOwner, entry)).ToList();
            if (attempts.Any(s => s.Status is LogStatus.Success or LogStatus.Skipped) &&
                !attempts.Any(s => s.Status == LogStatus.Error || s.Status == LogStatus.Pending && s.FamilyTypeName.Length > 0))
                entry.Success("Group completed all attempted type writes.");
        }
        return new OperationLog("Group completion", this._entries.Values.Select(e => e.Clone()).ToList());
    }

    public void Reset() {
        this._snapshots.Clear();
        // Reset entries to Pending state rather than clearing them
        // This preserves the initialized keys while allowing reuse across families
        foreach (var key in this._entries.Keys.ToList())
            this._entries[key] = new LogEntry(key);
        this._touchedThisOperation.Clear();
    }
}

/// <summary>
///     Context for a single family's processing run. Properties populated by pipeline and immutable after completion.
/// </summary>
public class FamilyProcessingContext {
    public string FamilyName { get; init; } = string.Empty;

    public long? LoadedFamilyId { get; internal set; }

    /// <summary>Artifact manifest generated for this family run, when output writing is enabled.</summary>
    public FamilyArtifactManifest? Artifacts { get; internal set; }

    /// <summary>Snapshot collected before processing.</summary>
    public FamilySnapshot? PreProcessSnapshot { get; internal set; }

    /// <summary>Snapshot collected after processing.</summary>
    public FamilySnapshot? PostProcessSnapshot { get; internal set; }

    /// <summary>Operation logs from processing, or an error if processing failed.</summary>
    public Result<List<OperationLog>> OperationLogs { get; internal set; } =
        new InvalidOperationException("Operation logs have not been initialized.");

    /// <summary>Total processing time in milliseconds.</summary>
    public double TotalMs { get; internal set; }

    /// <summary>Time spent collecting pre-snapshot in milliseconds.</summary>
    public double PreCollectionMs { get; internal set; }

    /// <summary>Time spent collecting post-snapshot in milliseconds.</summary>
    public double PostCollectionMs { get; internal set; }

    /// <summary>Time spent on operations (excluding collection) in milliseconds.</summary>
    public double OperationsMs { get; internal set; }

    /// <summary>Optional tag for storing additional context data (e.g., VariantSpec).</summary>
    public object? Tag { get; internal set; }

    /// <summary>Parameters this run created from scratch; a numeric 0 on one of them is Revit's blank (`run.blanksBecome`).</summary>
    public HashSet<string> CreatedParameters { get; } = new(StringComparer.Ordinal);

    /// <summary>Sources NormalizeParamSources kept because a value was left uncarried for want of a mappingUnit; the replan keeps them too.</summary>
    public HashSet<string> KeptSources { get; } = new(StringComparer.Ordinal);


    /// <summary>
    ///     Sketch planes, elements, types and the seconds they predict (proxy swarm 2026-09-08). Read once before the operations run;
    ///     emitted on the checkpoint row and the family report, never consulted by processing.
    /// </summary>
    public Pe.Revit.Extensions.FamDocument.FamilyComplexity? Complexity { get; internal set; }

    /// <summary>`ParameterDependencyGraph.ToText()` when <c>ExecutionOptions.CaptureDependencyGraph</c> is set; diagnostic only.</summary>
    public string? DependencyGraph { get; internal set; }


    /// <summary>Finds a parameter snapshot in the pre-process snapshot by name.</summary>
    public ParameterSnapshot? FindParameterSnapshot(string paramName) {
        var parameters = this.PreProcessSnapshot?.Parameters?.Data;
        if (parameters is null || parameters.Count == 0)
            return null;

        return parameters
            .Where(p => string.Equals(p.Name, paramName, StringComparison.Ordinal))
            .OrderByDescending(p => p.GetTypesWithValue().Count)
            .FirstOrDefault();
    }

    /// <summary>Gets the list of family types that have a value for the specified parameter.</summary>
    public List<string> GetTypesWithValue(string paramName) =>
        this.FindParameterSnapshot(paramName)?.GetTypesWithValue() ?? [];

    /// <summary>Checks if a parameter has a (non-empty) value for all family types.</summary>
    public bool HasValueForAllTypes(string paramName) =>
        this.FindParameterSnapshot(paramName)?.HasValueForAllTypes() == true;
}
