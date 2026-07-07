using Pe.Shared.RevitData;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Canonical family/parameter record language shared by DocumentData collection, FamilyFoundry
///     capture, and the matrix wire. Serialization-clean: built on
///     <see cref="ParameterDefinitionDescriptor" /> and plain values.
///     ValuesPerType preserves null (no value) vs "" (empty string value) — renderers coerce, the wire
///     does not.
/// </summary>
public sealed record FamilyParameterSnapshot(
    ParameterDefinitionDescriptor Definition,
    LoadedFamilyParameterKind Kind,
    LoadedFamilyParameterPresence Scope,
    string StorageType,
    FormulaState FormulaState,
    string? Formula,
    // TypeName -> value string. null = no value; "" = empty string value (String params). Preserved as-is.
    IReadOnlyDictionary<string, string?> ValuesPerType,
    ExcludedParameterReason? ExcludedReason = null
);

public sealed record FamilySnapshotRecord(
    long FamilyId,
    string FamilyUniqueId,
    string FamilyName,
    string? CategoryName,
    // Element.VersionGuid, stamped only at save/sync boundaries (persistent-cache key; never an in-session freshness check).
    string? VersionGuid,
    IReadOnlyList<string> TypeNames,
    IReadOnlyList<FamilyParameterSnapshot> Parameters,
    IReadOnlyList<RevitDataIssue> Issues,
    bool IsPartial,
    // Matrix decoration; unset outside project-context collection.
    int PlacedInstanceCount = 0,
    IReadOnlyList<string>? ScheduleNames = null
);
public sealed record FamilyEditorSnapshotRequest;

public sealed record FamilyEditorSnapshotData(
    string FamilyName,
    string CurrentTypeName,
    IReadOnlyList<string> TypeNames,
    IReadOnlyList<FamilyEditorParameterSnapshot> Parameters
);

public sealed record FamilyEditorParameterSnapshot(
    string Name,
    bool IsInstance,
    bool IsReadOnly,
    bool IsDeterminedByFormula,
    bool IsShared,
    string? Guid,
    string StorageType,
    string? DataType,
    string? Group,
    string? Formula,
    IReadOnlyDictionary<string, string> ValuesPerType
);

public sealed record FamilyEditorApplyRequest(
    IReadOnlyList<FamilyEditorApplyEdit> Edits
);

public sealed record FamilyEditorApplyEdit(
    string ParamName,
    string? TypeName,
    string? Value,
    string? Formula
);

public sealed record FamilyEditorApplyData(
    int Applied,
    IReadOnlyList<FamilyEditorApplyEditResult> Results
);

public sealed record FamilyEditorApplyEditResult(
    int Index,
    bool Ok,
    string? Error
);
