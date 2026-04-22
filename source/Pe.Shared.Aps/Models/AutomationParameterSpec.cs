namespace Pe.Shared.Aps.Models;

public sealed class AutomationParameterSpec {
    public string Verb { get; init; } = "";
    public string Description { get; init; } = "";
    public bool Required { get; init; }
    public string? LocalName { get; init; }
}

// PE_HOT_RELOAD_NUDGE