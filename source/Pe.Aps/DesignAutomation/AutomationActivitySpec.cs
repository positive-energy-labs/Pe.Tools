namespace Pe.Aps.DesignAutomation;

public sealed class AutomationActivitySpec {
    public string Id { get; init; } = "";
    public string Engine { get; init; } = "";
    public string Description { get; init; } = "";
    public string AliasId { get; init; } = "dev";
    public IReadOnlyList<string> AppBundles { get; init; } = [];
    public IReadOnlyList<string> CommandLine { get; init; } = [];

    public IReadOnlyDictionary<string, AutomationParameterSpec> Parameters { get; init; } =
        new Dictionary<string, AutomationParameterSpec>(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, object>? Settings { get; init; }
}

// PE_HOT_RELOAD_NUDGE