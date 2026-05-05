namespace Pe.Aps.DesignAutomation;

public sealed class AutomationAppBundleSpec {
    public string Id { get; init; } = "";
    public string? Package { get; init; }
    public string Engine { get; init; } = "";
    public string Description { get; init; } = "";
    public string AliasId { get; init; } = "dev";
}

// PE_HOT_RELOAD_NUDGE