using Newtonsoft.Json;

namespace Pe.Revit.Global.Services.Aps.Models;

public sealed class AutomationWorkItemStatus {
    [JsonProperty("id")] public string? Id { get; init; }
    [JsonProperty("status")] public string? Status { get; init; }
    [JsonProperty("reportUrl")] public string? ReportUrl { get; init; }
}

// PE_HOT_RELOAD_NUDGE
