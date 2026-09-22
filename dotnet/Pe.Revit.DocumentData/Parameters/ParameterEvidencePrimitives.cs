using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

public sealed record ParameterProjectBindingEvidence(
    ParameterDefinitionDescriptor Definition,
    ProjectParameterBindingKind BindingKind,
    IReadOnlyList<string> CategoryNames
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

public sealed record ParameterScheduleFieldEvidence(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? CategoryName,
    bool IsPlacedOnSheet,
    IReadOnlyList<string> SheetNumbers,
    IReadOnlyList<string> SheetNames,
    string FieldName,
    string ColumnHeading,
    ParameterDefinitionDescriptor Definition,
    int FieldIndex,
    bool IsHidden,
    bool IsCalculated,
    bool IsCombinedParameter,
    bool IsFilterField,
    string? FieldType,
    string? SpecTypeId
) {
    public ParameterIdentity Identity => this.Definition.Identity;
}

public sealed record ParameterEvidencePrimitiveSet(
    IReadOnlyList<ParameterProjectBindingEvidence> ProjectBindings,
    IReadOnlyList<ParameterScheduleFieldEvidence> ScheduleFields,
    DateTimeOffset CollectedAtUtc,
    bool CacheHit
);
