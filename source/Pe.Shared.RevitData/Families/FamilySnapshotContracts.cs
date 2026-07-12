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
    IReadOnlyDictionary<string, string> ValuesPerType,
    // Canonical parameter identity (minted via RevitParameterDefinition.ObservedFamilyParameter — never
    // hand-rolled key prefixes). Null when identity could not be resolved.
    ParameterIdentity? Identity = null,
    // Formula graph, one level deep, by parameter name. DependsOn = params THIS formula references;
    // Dependents = params whose formulas reference THIS one. Null (not empty) when there is nothing.
    IReadOnlyList<string>? DependsOn = null,
    IReadOnlyList<string>? Dependents = null,
    // Direct element associations (dims/arrays/nested), one level deep. Null when none.
    FamilyParameterAssociationInfo? Associations = null
);

/// <summary>
///     Direct (element-based) associations for a family parameter, one level deep. Dimensions and Arrays
///     are "Name [ID:{id}]" labels; Nested carries element-parameter associations (nested instances,
///     connectors). Phantom parameters/elements (negative ids, dangling) are filtered out.
/// </summary>
public sealed record FamilyParameterAssociationInfo(
    IReadOnlyList<string> Dimensions,
    IReadOnlyList<string> Arrays,
    IReadOnlyList<FamilyNestedAssociation> Nested
);

public sealed record FamilyNestedAssociation(
    string ElementName,
    string ElementId,
    string ParamName
);

public sealed record FamilyEditorApplyRequest(
    IReadOnlyList<FamilyEditorApplyEdit> Edits,
    // Run the full edit sequence inside a transaction, then roll back — validate without persisting.
    bool DryRun = false
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
