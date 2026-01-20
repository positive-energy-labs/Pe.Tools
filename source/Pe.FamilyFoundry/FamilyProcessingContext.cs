using Pe.FamilyFoundry.Aggregators.Snapshots;

namespace Pe.FamilyFoundry;

/// <summary>
///     Inter-operation state container for coordinating log entries across operations within an OperationGroup.
///     Created by OperationGroup, reset per-family by the OperationProcessor to ensure clean state.
/// </summary>
public class OperationContext {
    private readonly Dictionary<string, LogEntry> _entries = new();
    private readonly HashSet<string> _touchedThisOperation = [];
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
        return snapshot;
    }

    public void Reset() {
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
    public required string FamilyName { get; init; }

    /// <summary>Snapshot collected before processing.</summary>
    public FamilySnapshot PreProcessSnapshot { get; internal set; }

    /// <summary>Snapshot collected after processing.</summary>
    public FamilySnapshot PostProcessSnapshot { get; internal set; }

    /// <summary>Operation logs from processing, or an error if processing failed.</summary>
    public Result<List<OperationLog>> OperationLogs { get; internal set; }

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


    /// <summary>Finds a parameter in the pre-process snapshot by name.</summary>
    public ParamSnapshot FindParam(string paramName) {
        var parameters = this.PreProcessSnapshot?.Parameters?.Data;
        if (parameters is null || parameters.Count == 0)
            return null;

        return parameters
            .Where(p => string.Equals(p.Name, paramName, StringComparison.Ordinal))
            .OrderByDescending(p => p.GetTypesWithValue().Count)
            .FirstOrDefault();
    }

    /// <summary>Gets the list of family types that have a value for the specified parameter.</summary>
    public List<string> GetTypesWithValue(string paramName) => this.FindParam(paramName).GetTypesWithValue();

    /// <summary>Checks if a parameter has a (non-empty) value for all family types.</summary>
    public bool HasValueForAllTypes(string paramName) => this.FindParam(paramName).HasValueForAllTypes();
}