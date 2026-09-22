using Newtonsoft.Json;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.RevitVersions;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class ScheduleCollectionBatchManifest {
    [JsonProperty("engine")] public string? Engine { get; init; }

    [JsonProperty("timeoutSeconds")]
    public int TimeoutSeconds { get; init; } = ScheduleCollectionOptions.DefaultTimeoutSeconds;

    [JsonProperty("maxConcurrency")] public int MaxConcurrency { get; init; } = 4;
    [JsonProperty("debug")] public bool Debug { get; init; } = true;
    [JsonProperty("mask")] public bool Mask { get; init; } = true;

    [JsonProperty("request")]
    public ScheduleCollectionBatchRequest? Request { get; init; }

    [JsonProperty("models")] public List<ScheduleCollectionBatchEntry> Models { get; init; } = [];

    public void Validate() {
        if (this.Models.Count == 0)
            throw new InvalidDataException("Batch manifest must include at least one model entry.");

        foreach (var model in this.Models)
            model.Validate(this.Engine);
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
    [JsonProperty("revitYear")] public int? RevitYear { get; init; }
    [JsonProperty("request")] public ScheduleCollectionBatchRequest? Request { get; init; }

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

    public ScheduleCollectionOptions ToOptions(ScheduleCollectionBatchManifest manifest, string engine, bool json = false) {
        var manifestRequest = manifest.Request ??
            ScheduleCollectionBatchRequest.FromContract(ScheduleCollectionDefaults.CreateDefaultRequest());
        var request = ScheduleCollectionBatchRequest.Merge(manifestRequest, this.Request).ToContract();

        return new ScheduleCollectionOptions(
            this.Region,
            this.ProjectGuid,
            this.ModelGuid,
            this.ExpectedTitle,
            engine,
            manifest.TimeoutSeconds,
            manifest.Debug,
            manifest.Mask,
            json,
            request
        );
    }
}

public sealed class ScheduleCollectionBatchRequest {
    [JsonProperty("primaryCatalogRequest")]
    public ScheduleCatalogBatchRequest? PrimaryCatalogRequest { get; init; }

    [JsonProperty("fallbackCatalogRequest")]
    public ScheduleCatalogBatchRequest? FallbackCatalogRequest { get; init; }

    public ScheduleCollectionRequest ToContract() =>
        new(
            this.PrimaryCatalogRequest?.ToContract(),
            this.FallbackCatalogRequest?.ToContract()
        );

    public static ScheduleCollectionBatchRequest FromContract(ScheduleCollectionRequest request) =>
        new() {
            PrimaryCatalogRequest = ScheduleCatalogBatchRequest.FromContract(request.PrimaryCatalogRequest),
            FallbackCatalogRequest = ScheduleCatalogBatchRequest.FromContract(request.FallbackCatalogRequest)
        };

    internal static ScheduleCollectionBatchRequest Merge(
        ScheduleCollectionBatchRequest manifestRequest,
        ScheduleCollectionBatchRequest? entryRequest
    ) {
        if (entryRequest == null)
            return Clone(manifestRequest);

        return new ScheduleCollectionBatchRequest {
            PrimaryCatalogRequest = MergeCatalogRequest(
                manifestRequest.PrimaryCatalogRequest,
                entryRequest.PrimaryCatalogRequest
            ),
            FallbackCatalogRequest = MergeCatalogRequest(
                manifestRequest.FallbackCatalogRequest,
                entryRequest.FallbackCatalogRequest
            )
        };
    }

    private static ScheduleCollectionBatchRequest Clone(ScheduleCollectionBatchRequest request) =>
        new() {
            PrimaryCatalogRequest = CloneCatalogRequest(request.PrimaryCatalogRequest),
            FallbackCatalogRequest = CloneCatalogRequest(request.FallbackCatalogRequest)
        };

    private static ScheduleCatalogBatchRequest? MergeCatalogRequest(
        ScheduleCatalogBatchRequest? manifestRequest,
        ScheduleCatalogBatchRequest? entryRequest
    ) {
        if (entryRequest == null)
            return CloneCatalogRequest(manifestRequest);

        if (manifestRequest == null)
            return CloneCatalogRequest(entryRequest);

        return new ScheduleCatalogBatchRequest {
            CategoryNames = HasValues(entryRequest.CategoryNames)
                ? [.. entryRequest.CategoryNames!]
                : CloneList(manifestRequest.CategoryNames),
            ScheduleNames = HasValues(entryRequest.ScheduleNames)
                ? [.. entryRequest.ScheduleNames!]
                : CloneList(manifestRequest.ScheduleNames),
            CustomParameterFilters = HasValues(entryRequest.CustomParameterFilters)
                ? [.. entryRequest.CustomParameterFilters!]
                : CloneList(manifestRequest.CustomParameterFilters),
            IncludeTemplates = entryRequest.IncludeTemplates ?? manifestRequest.IncludeTemplates
        };
    }

    private static ScheduleCatalogBatchRequest? CloneCatalogRequest(ScheduleCatalogBatchRequest? request) {
        if (request == null)
            return null;

        return new ScheduleCatalogBatchRequest {
            CategoryNames = CloneList(request.CategoryNames),
            ScheduleNames = CloneList(request.ScheduleNames),
            CustomParameterFilters = CloneList(request.CustomParameterFilters),
            IncludeTemplates = request.IncludeTemplates
        };
    }

    private static List<T>? CloneList<T>(IEnumerable<T>? values) => values == null ? null : [.. values.Distinct()];

    private static bool HasValues<T>(IReadOnlyCollection<T>? values) => values is { Count: > 0 };
}

public sealed class ScheduleCatalogBatchRequest {
    [JsonProperty("categoryNames")] public List<string>? CategoryNames { get; init; }
    [JsonProperty("scheduleNames")] public List<string>? ScheduleNames { get; init; }

    [JsonProperty("customParameterFilters")]
    public List<ScheduleCustomParameterFilter>? CustomParameterFilters { get; init; }

    [JsonProperty("includeTemplates")] public bool? IncludeTemplates { get; init; }

    public ScheduleCatalogRequest ToContract() =>
        new() {
            CategoryNames = [.. (this.CategoryNames ?? [])],
            ScheduleNames = [.. (this.ScheduleNames ?? [])],
            CustomParameterFilters = [.. (this.CustomParameterFilters ?? [])],
            IncludeTemplates = this.IncludeTemplates.GetValueOrDefault()
        };

    public static ScheduleCatalogBatchRequest? FromContract(ScheduleCatalogRequest? request) {
        if (request == null)
            return null;

        return new ScheduleCatalogBatchRequest {
            CategoryNames = [.. request.CategoryNames],
            ScheduleNames = [.. request.ScheduleNames],
            CustomParameterFilters = [.. request.CustomParameterFilters],
            IncludeTemplates = request.IncludeTemplates
        };
    }
}

public sealed class ScheduleCollectionBatchResult {
    public string ManifestPath { get; init; } = "";
    public int TotalModelCount { get; init; }
    public int SuccessCount { get; init; }
    public int FailureCount { get; init; }
    public List<ScheduleCollectionResult> Results { get; init; } = [];
}
