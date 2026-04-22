using Newtonsoft.Json;
using Pe.Shared.RevitData.Schedules;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class ScheduleCollectionBatchManifest {
    [JsonProperty("engine")] public string Engine { get; init; } = ScheduleCollectionOptions.DefaultEngine;

    [JsonProperty("timeoutSeconds")]
    public int TimeoutSeconds { get; init; } = ScheduleCollectionOptions.DefaultTimeoutSeconds;

    [JsonProperty("maxConcurrency")] public int MaxConcurrency { get; init; } = 4;
    [JsonProperty("debug")] public bool Debug { get; init; } = true;
    [JsonProperty("mask")] public bool Mask { get; init; } = true;

    [JsonProperty("request")]
    public ScheduleCollectionRequest Request { get; init; } = ScheduleCollectionDefaults.CreateDefaultRequest();

    [JsonProperty("models")] public List<ScheduleCollectionBatchEntry> Models { get; init; } = [];

    public void Validate() {
        if (this.Models.Count == 0)
            throw new InvalidDataException("Batch manifest must include at least one model entry.");

        foreach (var model in this.Models)
            model.Validate();
    }

    public static ScheduleCollectionBatchManifest LoadFromFile(string filePath) {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"Schedule collection batch manifest '{filePath}' was not found.",
                filePath);

        var manifest = JsonConvert.DeserializeObject<ScheduleCollectionBatchManifest>(File.ReadAllText(filePath))
                       ?? throw new InvalidDataException(
                           "Schedule collection batch manifest JSON was empty or invalid.");
        manifest.Validate();
        return manifest;
    }
}

public sealed class ScheduleCollectionBatchEntry {
    [JsonProperty("region")] public string Region { get; init; } = "";
    [JsonProperty("projectGuid")] public string ProjectGuid { get; init; } = "";
    [JsonProperty("modelGuid")] public string ModelGuid { get; init; } = "";
    [JsonProperty("expectedTitle")] public string? ExpectedTitle { get; init; }
    [JsonProperty("request")] public ScheduleCollectionRequest? Request { get; init; }

    public void Validate() {
        if (string.IsNullOrWhiteSpace(this.Region))
            throw new InvalidDataException("Batch entry region is required.");
        if (!Guid.TryParse(this.ProjectGuid, out _))
            throw new InvalidDataException($"Batch entry projectGuid '{this.ProjectGuid}' must be a GUID.");
        if (!Guid.TryParse(this.ModelGuid, out _))
            throw new InvalidDataException($"Batch entry modelGuid '{this.ModelGuid}' must be a GUID.");
    }

    public ScheduleCollectionOptions ToOptions(ScheduleCollectionBatchManifest manifest, bool json = false) =>
        new(
            this.Region,
            this.ProjectGuid,
            this.ModelGuid,
            this.ExpectedTitle,
            manifest.Engine,
            manifest.TimeoutSeconds,
            manifest.Debug,
            manifest.Mask,
            json,
            this.Request ?? manifest.Request
        );
}

public sealed class ScheduleCollectionBatchResult {
    public string ManifestPath { get; init; } = "";
    public int TotalModelCount { get; init; }
    public int SuccessCount { get; init; }
    public int FailureCount { get; init; }
    public List<ScheduleCollectionResult> Results { get; init; } = [];
}