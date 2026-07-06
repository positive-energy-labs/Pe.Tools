using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ConceptEvidenceConfidence {
    Low,
    Medium,
    High
}

public record ConceptEvidenceRequest {
    public string? Query { get; init; }
    public List<string> ConceptHints { get; init; } = [];
    public List<string> SubjectHints { get; init; } = [];
    public bool IncludeBindings { get; init; } = true;
    public bool IncludeSchedules { get; init; } = true;
    public RevitDataOutputBudget? Budget { get; init; }
}

public record ConceptEvidenceFacts(
    int BindingCount,
    List<string> BindingCategories,
    int ScheduleFieldCount,
    int ScheduleFilterCount,
    double? AverageFieldIndex,
    int PlacedScheduleFieldCount,
    List<string> SampleSchedules
);

public record ConceptEvidenceCandidate(
    ParameterDefinitionDescriptor Definition,
    double Score,
    ConceptEvidenceConfidence Confidence,
    List<string> Reasons,
    ConceptEvidenceFacts Facts
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

public record ConceptEvidenceCard(
    string Concept,
    List<ConceptEvidenceCandidate> Candidates,
    List<string> EvidenceNotes
);

public record ConceptEvidenceData(
    List<ConceptEvidenceCard> Concepts,
    List<RevitDataIssue> Issues,
    RevitDataResultPage? Page = null,
    string? EvidenceCollectedAtUtc = null,
    bool? PrimitiveCacheHit = null
);
