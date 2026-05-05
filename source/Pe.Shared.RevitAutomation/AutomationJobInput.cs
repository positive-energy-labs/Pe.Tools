using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.RevitAutomation;

[JsonConverter(typeof(StringEnumConverter))]
public enum AutomationJobType {
    CloudOpenProbe,
    ParameterCollection,
    ScheduleCollection
}

[JsonConverter(typeof(StringEnumConverter))]
public enum AutomationDocumentSourceKind {
    CloudModel,
    LocalFile
}

public sealed class AutomationJobInput {
    [JsonProperty("jobType")] public AutomationJobType JobType { get; init; }
    [JsonProperty("sourceKind")] public AutomationDocumentSourceKind SourceKind { get; init; } = AutomationDocumentSourceKind.CloudModel;
    [JsonProperty("engine")] public string Engine { get; init; } = "";
    [JsonProperty("region")] public string Region { get; init; } = "";
    [JsonProperty("projectGuid")] public string ProjectGuid { get; init; } = "";
    [JsonProperty("modelGuid")] public string ModelGuid { get; init; } = "";
    [JsonProperty("localModelPath")] public string? LocalModelPath { get; init; }
    [JsonProperty("runId")] public string RunId { get; init; } = "";
    [JsonProperty("expectedTitle")] public string? ExpectedTitle { get; init; }
    [JsonProperty("parameterCollection")] public ParameterCollectionRequest? ParameterCollection { get; init; }
    [JsonProperty("scheduleCollection")] public ScheduleCollectionRequest? ScheduleCollection { get; init; }

    public string GetNormalizedRegion() {
        var normalized = this.Region.Trim().ToUpperInvariant();
        return normalized switch {
            "US" => "US",
            "EMEA" => "EMEA",
            _ => throw new InvalidDataException($"Unsupported automation region '{this.Region}'.")
        };
    }

    public Guid GetProjectGuid() => ParseGuid(this.ProjectGuid, nameof(this.ProjectGuid));
    public Guid GetModelGuid() => ParseGuid(this.ModelGuid, nameof(this.ModelGuid));
    public string GetRequiredLocalModelPath() =>
        !string.IsNullOrWhiteSpace(this.LocalModelPath)
            ? this.LocalModelPath!
            : throw new InvalidDataException("LocalModelPath is required for LocalFile automation jobs.");

    public void Validate() {
        switch (this.SourceKind) {
        case AutomationDocumentSourceKind.CloudModel:
            _ = this.GetNormalizedRegion();
            _ = this.GetProjectGuid();
            _ = this.GetModelGuid();
            break;
        case AutomationDocumentSourceKind.LocalFile:
            _ = this.GetRequiredLocalModelPath();
            break;
        default:
            throw new InvalidDataException($"Unsupported automation source kind '{this.SourceKind}'.");
        }

        if (!Guid.TryParse(this.RunId, out _))
            throw new InvalidDataException($"RunId '{this.RunId}' must be a GUID.");

        if (this.JobType == AutomationJobType.ParameterCollection && this.ParameterCollection == null)
            throw new InvalidDataException("ParameterCollection payload is required for ParameterCollection jobs.");
        if (this.JobType == AutomationJobType.ScheduleCollection && this.ScheduleCollection == null)
            throw new InvalidDataException("ScheduleCollection payload is required for ScheduleCollection jobs.");
    }

    public string ToJson() {
        this.Validate();
        return JsonConvert.SerializeObject(this, Formatting.None);
    }

    public static AutomationJobInput FromJson(string json) {
        var input = JsonConvert.DeserializeObject<AutomationJobInput>(json)
                    ?? throw new InvalidDataException("Automation job input JSON was empty or invalid.");
        input.Validate();
        return input;
    }

    public static AutomationJobInput LoadFromFile(string filePath) {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"Automation job input file '{filePath}' was not found.", filePath);

        return FromJson(File.ReadAllText(filePath));
    }

    public static AutomationJobInput ForCloudOpenProbe(
        string engine,
        string region,
        string projectGuid,
        string modelGuid,
        string runId,
        string? expectedTitle = null
    ) =>
        new() {
            JobType = AutomationJobType.CloudOpenProbe,
            SourceKind = AutomationDocumentSourceKind.CloudModel,
            Engine = engine,
            Region = region,
            ProjectGuid = projectGuid,
            ModelGuid = modelGuid,
            RunId = runId,
            ExpectedTitle = expectedTitle
        };

    private static Guid ParseGuid(string value, string fieldName) {
        if (!Guid.TryParse(value, out var parsed))
            throw new InvalidDataException($"{fieldName} '{value}' must be a GUID.");

        return parsed;
    }
}

// PE_HOT_RELOAD_NUDGE
