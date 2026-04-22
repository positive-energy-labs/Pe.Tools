using Newtonsoft.Json;

namespace Pe.Shared.Aps.Models;

public sealed class AutomationCloudOpenProbeInput {
    [JsonProperty("region")] public string Region { get; init; } = "";
    [JsonProperty("projectGuid")] public string ProjectGuid { get; init; } = "";
    [JsonProperty("modelGuid")] public string ModelGuid { get; init; } = "";
    [JsonProperty("probeRunId")] public string ProbeRunId { get; init; } = "";
    [JsonProperty("expectedTitle")] public string? ExpectedTitle { get; init; }

    public string GetNormalizedRegion() {
        var normalized = this.Region.Trim().ToUpperInvariant();
        return normalized switch {
            "US" => "US",
            "EMEA" => "EMEA",
            _ => throw new InvalidDataException($"Unsupported automation probe region '{this.Region}'.")
        };
    }

    public Guid GetProjectGuid() => ParseGuid(this.ProjectGuid, nameof(this.ProjectGuid));
    public Guid GetModelGuid() => ParseGuid(this.ModelGuid, nameof(this.ModelGuid));

    public void Validate() {
        _ = this.GetNormalizedRegion();
        _ = this.GetProjectGuid();
        _ = this.GetModelGuid();
        if (!Guid.TryParse(this.ProbeRunId, out _))
            throw new InvalidDataException($"ProbeRunId '{this.ProbeRunId}' must be a GUID.");
    }

    public string ToJson() {
        this.Validate();
        return JsonConvert.SerializeObject(this, Formatting.None);
    }

    public static AutomationCloudOpenProbeInput FromJson(string json) {
        var input = JsonConvert.DeserializeObject<AutomationCloudOpenProbeInput>(json)
                    ?? throw new InvalidDataException("Automation probe input JSON was empty or invalid.");
        input.Validate();
        return input;
    }

    public static AutomationCloudOpenProbeInput LoadFromFile(string filePath) {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"Automation probe input file '{filePath}' was not found.", filePath);

        return FromJson(File.ReadAllText(filePath));
    }

    private static Guid ParseGuid(string value, string fieldName) {
        if (!Guid.TryParse(value, out var parsed))
            throw new InvalidDataException($"{fieldName} '{value}' must be a GUID.");

        return parsed;
    }
}

// PE_HOT_RELOAD_NUDGE