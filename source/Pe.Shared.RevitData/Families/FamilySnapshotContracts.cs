using Pe.Shared.RevitData;

namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Canonical family/parameter record language shared by DocumentData collection and FamilyFoundry
///     capture. Serialization-clean: built on <see cref="ParameterDefinitionDescriptor" /> and plain values.
///     Goes on the wire in the matrix reshape phase (gets [ExportTsSchema] then).
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
