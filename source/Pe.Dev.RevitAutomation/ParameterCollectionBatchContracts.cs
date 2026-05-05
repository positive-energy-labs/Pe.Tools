using Newtonsoft.Json;
using Pe.Shared.RevitData;
using Pe.Shared.RevitVersions;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class ParameterCollectionBatchManifest {
    [JsonProperty("engine")] public string? Engine { get; init; }

    [JsonProperty("timeoutSeconds")]
    public int TimeoutSeconds { get; init; } = ParameterCollectionOptions.DefaultTimeoutSeconds;

    [JsonProperty("maxConcurrency")] public int MaxConcurrency { get; init; } = 4;
    [JsonProperty("debug")] public bool Debug { get; init; } = true;
    [JsonProperty("mask")] public bool Mask { get; init; } = true;
    [JsonProperty("models")] public List<ParameterCollectionBatchEntry> Models { get; init; } = [];

    public void Validate() {
        if (this.Models.Count == 0)
            throw new InvalidDataException("Batch manifest must include at least one model entry.");

        foreach (var model in this.Models)
            model.Validate(this.Engine);
    }

    public static ParameterCollectionBatchManifest LoadFromFile(string filePath) {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"Parameter collection batch manifest '{filePath}' was not found.",
                filePath);

        var manifest = JsonConvert.DeserializeObject<ParameterCollectionBatchManifest>(File.ReadAllText(filePath))
                       ?? throw new InvalidDataException(
                           "Parameter collection batch manifest JSON was empty or invalid.");
        manifest.Validate();
        return manifest;
    }
}

public sealed class ParameterCollectionBatchEntry {
    [JsonProperty("region")] public string Region { get; init; } = "";
    [JsonProperty("projectGuid")] public string ProjectGuid { get; init; } = "";
    [JsonProperty("modelGuid")] public string ModelGuid { get; init; } = "";
    [JsonProperty("expectedTitle")] public string? ExpectedTitle { get; init; }
    [JsonProperty("revitYear")] public int? RevitYear { get; init; }
    [JsonProperty("filter")] public LoadedFamiliesFilter? Filter { get; init; }

    public void Validate(string? manifestEngine = null) {
        if (string.IsNullOrWhiteSpace(this.Region))
            throw new InvalidDataException("Batch entry region is required.");
        if (!Guid.TryParse(this.ProjectGuid, out _))
            throw new InvalidDataException($"Batch entry projectGuid '{this.ProjectGuid}' must be a GUID.");
        if (!Guid.TryParse(this.ModelGuid, out _))
            throw new InvalidDataException($"Batch entry modelGuid '{this.ModelGuid}' must be a GUID.");

        _ = this.ResolveSpec(manifestEngine);
    }

    public RevitVersionSpec ResolveSpec(string? manifestEngine) {
        var specFromYear = this.RevitYear.HasValue ? RevitVersionCatalog.RequireByYear(this.RevitYear.Value) : null;
        var specFromEngine = !string.IsNullOrWhiteSpace(manifestEngine)
            ? RevitVersionCatalog.RequireByAutomationEngine(manifestEngine)
            : null;

        if (specFromYear is null && specFromEngine is null)
            throw new InvalidDataException(
                $"Batch entry {this.ModelGuid} must provide `revitYear` or the manifest must provide `engine`.");

        if (specFromYear is not null && specFromEngine is not null && specFromYear.Year != specFromEngine.Year)
            throw new InvalidDataException(
                $"Batch entry {this.ModelGuid} revitYear '{specFromYear.Year}' conflicts with manifest engine '{manifestEngine}'.");

        return specFromYear ?? specFromEngine!;
    }

    public ParameterCollectionOptions ToOptions(ParameterCollectionBatchManifest manifest, string engine, bool json = false) =>
        new(
            this.Region,
            this.ProjectGuid,
            this.ModelGuid,
            this.ExpectedTitle,
            engine,
            manifest.TimeoutSeconds,
            manifest.Debug,
            manifest.Mask,
            json,
            this.Filter
        );
}

public sealed class ParameterCollectionBatchResult {
    public string ManifestPath { get; init; } = "";
    public int TotalModelCount { get; init; }
    public int SuccessCount { get; init; }
    public int FailureCount { get; init; }
    public List<ParameterCollectionResult> Results { get; init; } = [];
}
