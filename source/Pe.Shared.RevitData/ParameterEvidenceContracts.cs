using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterEvidenceRankingMode {
    General,
    Tagging,
    ScheduleJoin,
    ElectricalJoin
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterEvidenceSource {
    ProjectBinding,
    ScheduleField,
    ScheduleFilter,
    ScopedElement
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterEvidenceScope {
    Document,
    Category,
    Schedule,
    PrintedSchedule,
    ActiveViewVisible,
    CurrentSelection,
    ExplicitHandles
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterEvidenceStrength {
    Weak,
    Medium,
    Strong
}

[ExportTsInterface]
public record ParameterEvidenceRequest {
    public string? TaskText { get; init; }
    public ParameterEvidenceRankingMode RankingMode { get; init; } = ParameterEvidenceRankingMode.General;
    public List<string> CategoryNames { get; init; } = [];
    public RevitElementScope Scope { get; init; } = RevitElementScope.All;
    public List<long> ElementIds { get; init; } = [];
    public List<string> ElementUniqueIds { get; init; } = [];
    public List<long> ScheduleIds { get; init; } = [];
    public List<string> ScheduleUniqueIds { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public List<ParameterReference> CandidateParameters { get; init; } = [];
    public RevitDataOutputBudget? Budget { get; init; }
    public bool UseCache { get; init; } = true;
}

[ExportTsInterface]
public record ParameterEvidenceCount(
    ParameterEvidenceSource Source,
    ParameterEvidenceScope Scope,
    ParameterEvidenceStrength Strength,
    int Count
);

[ExportTsInterface]
public record ParameterEvidenceSample(
    ParameterEvidenceSource Source,
    ParameterEvidenceScope Scope,
    ParameterEvidenceStrength Strength,
    string Reason,
    string? CategoryName = null,
    string? ScheduleName = null,
    string? ElementName = null,
    RevitElementHandle? Element = null
);

[ExportTsInterface]
public record ParameterEvidenceCandidate(
    ParameterDefinitionDescriptor Definition,
    double Score,
    List<string> Reasons,
    List<ParameterEvidenceCount> EvidenceCounts,
    List<ParameterEvidenceSample> Samples
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

[ExportTsInterface]
public record ParameterEvidenceData(
    List<ParameterEvidenceCandidate> Candidates,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null,
    string? EvidenceCollectedAtUtc = null,
    bool? PrimitiveCacheHit = null
);
