using Newtonsoft.Json;

namespace Pe.Aps.DesignAutomation;

public sealed class AutomationParameterSpec {
    [JsonProperty("verb")]
    public string Verb { get; init; } = "";

    [JsonProperty("description")]
    public string Description { get; init; } = "";

    [JsonProperty("required")]
    public bool Required { get; init; }

    [JsonProperty("localName")]
    public string? LocalName { get; init; }
}
