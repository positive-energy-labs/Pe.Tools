using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.RevitData.Schedules;
using System.Runtime.Serialization;
using System.IO;

namespace Pe.Dev.RevitAutomation;

[JsonConverter(typeof(StringEnumConverter))]
public enum AutomationManifestYearResolutionSource {
    [EnumMember(Value = "aps")]
    Aps,

    [EnumMember(Value = "manifest-hint")]
    ManifestHint
}

[JsonConverter(typeof(StringEnumConverter))]
public enum AutomationProcessingMode {
    [EnumMember(Value = "direct-cloud")]
    DirectCloud,

    [EnumMember(Value = "transient-local-upgrade")]
    TransientLocalUpgrade
}

[JsonConverter(typeof(StringEnumConverter))]
public enum AutomationStagedInputKind {
    [EnumMember(Value = "rvt")]
    Rvt,

    [EnumMember(Value = "unsupported-package")]
    UnsupportedPackage
}

public sealed class ScheduleAuditManifest {
    [JsonProperty("hub")]
    public string Hub { get; init; } = "";

    [JsonProperty("timeoutSeconds")]
    public int TimeoutSeconds { get; init; } = ScheduleCollectionOptions.DefaultTimeoutSeconds;

    [JsonProperty("debug")]
    public bool Debug { get; init; } = true;

    [JsonProperty("mask")]
    public bool Mask { get; init; } = true;

    [JsonProperty("request")]
    public ScheduleCollectionBatchRequest? Request { get; init; }

    [JsonProperty("models")]
    public List<ScheduleAuditManifestEntry> Models { get; init; } = [];

    public void Validate() {
        if (string.IsNullOrWhiteSpace(this.Hub))
            throw new InvalidDataException("Manifest hub is required.");
        if (this.Models.Count == 0)
            throw new InvalidDataException("Schedule audit manifest must include at least one model entry.");

        foreach (var model in this.Models)
            model.Validate();
    }

    public static ScheduleAuditManifest LoadFromFile(string path) {
        if (!File.Exists(path))
            throw new FileNotFoundException($"Schedule audit manifest '{path}' was not found.", path);

        var manifest = JsonConvert.DeserializeObject<ScheduleAuditManifest>(File.ReadAllText(path))
                       ?? throw new InvalidDataException("Schedule audit manifest JSON was empty or invalid.");
        manifest.Validate();
        return manifest;
    }
}

public sealed class ScheduleAuditManifestEntry {
    [JsonProperty("project")]
    public string Project { get; init; } = "";

    [JsonProperty("modelPath")]
    public string ModelPath { get; init; } = "";

    [JsonProperty("revitYearHint")]
    public int? RevitYearHint { get; init; }

    [JsonProperty("note")]
    public string? Note { get; init; }

    public void Validate() {
        if (string.IsNullOrWhiteSpace(this.Project))
            throw new InvalidDataException("Manifest model project is required.");
        if (string.IsNullOrWhiteSpace(this.ModelPath))
            throw new InvalidDataException("Manifest modelPath is required.");
        if (this.RevitYearHint.HasValue && this.RevitYearHint.Value < AutomationProcessingRouteService.MinimumSupportedSourceYear)
            throw new InvalidDataException(
                $"Manifest revitYearHint '{this.RevitYearHint.Value}' must be at least {AutomationProcessingRouteService.MinimumSupportedSourceYear}.");
    }
}

public sealed class AutomationRunReceipt {
    [JsonProperty("submittedAtUtc")]
    public string SubmittedAtUtc { get; init; } = DateTime.UtcNow.ToString("O");

    [JsonProperty("manifestPath")]
    public string ManifestPath { get; init; } = "";

    [JsonProperty("hub")]
    public string Hub { get; init; } = "";

    [JsonProperty("entries")]
    public List<AutomationRunReceiptEntry> Entries { get; init; } = [];

    public static AutomationRunReceipt LoadFromFile(string path) {
        if (!File.Exists(path))
            throw new FileNotFoundException($"Automation run receipt '{path}' was not found.", path);

        return JsonConvert.DeserializeObject<AutomationRunReceipt>(File.ReadAllText(path))
               ?? throw new InvalidDataException("Automation run receipt JSON was empty or invalid.");
    }
}

public sealed class AutomationRunReceiptEntry {
    [JsonProperty("project")]
    public string Project { get; init; } = "";

    [JsonProperty("modelPath")]
    public string ModelPath { get; init; } = "";

    [JsonProperty("workItemId")]
    public string? WorkItemId { get; set; }

    [JsonProperty("revitYear")]
    public int? RevitYear { get; set; }

    [JsonProperty("processingMode")]
    public AutomationProcessingMode? ProcessingMode { get; set; }

    [JsonProperty("sourceRevitYear")]
    public int? SourceRevitYear { get; set; }

    [JsonProperty("executionRevitYear")]
    public int? ExecutionRevitYear { get; set; }

    [JsonProperty("yearResolutionSource")]
    public AutomationManifestYearResolutionSource? YearResolutionSource { get; set; }

    [JsonProperty("stagedInputKind")]
    public AutomationStagedInputKind? StagedInputKind { get; set; }

    [JsonProperty("region")]
    public string? Region { get; set; }

    [JsonProperty("projectGuid")]
    public string? ProjectGuid { get; set; }

    [JsonProperty("modelGuid")]
    public string? ModelGuid { get; set; }

    [JsonProperty("status")]
    public string? Status { get; set; }

    [JsonProperty("reportUrl")]
    public string? ReportUrl { get; set; }

    [JsonProperty("artifactBucketKey")]
    public string? ArtifactBucketKey { get; set; }

    [JsonProperty("artifactObjectKey")]
    public string? ArtifactObjectKey { get; set; }

    [JsonProperty("artifactLocalPath")]
    public string? ArtifactLocalPath { get; set; }

    [JsonProperty("documentTitle")]
    public string? DocumentTitle { get; set; }

    [JsonProperty("failureMessage")]
    public string? FailureMessage { get; set; }

    [JsonProperty("fallbackReason")]
    public string? FallbackReason { get; set; }

    [JsonProperty("rawReportExcerpt")]
    public string? RawReportExcerpt { get; set; }
}

public sealed class ModelResolutionResult {
    public string HubId { get; init; } = "";
    public string HubName { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Region { get; init; } = "";
    public int? RevitYear { get; init; }
    public string ItemId { get; init; } = "";
    public string VersionId { get; init; } = "";
    public string ProjectGuid { get; init; } = "";
    public string ModelGuid { get; init; } = "";
    public string ModelTitle { get; init; } = "";
    public string FolderPath { get; init; } = "";
    public string ModelPath { get; init; } = "";
    public string ResolutionSource { get; init; } = "";
}

public sealed class AutomationModelInventoryResult {
    public DateTime GeneratedAtUtc { get; init; } = DateTime.UtcNow;
    public string HubName { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Region { get; init; } = "";
    public string ScopePath { get; init; } = "";
    public bool Recursive { get; init; }
    public List<ModelResolutionResult> Models { get; init; } = [];
}

public sealed class AutomationManifestValidationResult {
    public string ManifestPath { get; init; } = "";
    public bool IsValid => this.Entries.All(entry => entry.IsValid);
    public List<AutomationManifestValidationEntry> Entries { get; init; } = [];
}

public sealed class AutomationManifestValidationEntry {
    public string Project { get; init; } = "";
    public string ModelPath { get; init; } = "";
    public int? SourceRevitYear { get; init; }
    public int? ExecutionRevitYear { get; init; }
    public AutomationManifestYearResolutionSource? YearResolutionSource { get; init; }
    public AutomationProcessingMode? ProcessingMode { get; init; }
    public string? FallbackReason { get; init; }
    public bool IsValid { get; init; }
    public string? FailureMessage { get; init; }
    public ModelResolutionResult? ResolvedModel { get; init; }
}
