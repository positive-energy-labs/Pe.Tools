namespace Pe.Shared.Aps.Models;

public sealed class AutomationWorkItemSpec {
    public string ActivityId { get; init; } = "";

    public IReadOnlyDictionary<string, object> Arguments { get; init; } =
        new Dictionary<string, object>(StringComparer.Ordinal);

    public int? LimitProcessingTimeSec { get; init; }
    public bool? Debug { get; init; }
}

// PE_HOT_RELOAD_NUDGE