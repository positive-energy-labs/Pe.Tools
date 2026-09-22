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
    ExcludedParameterReason? ExcludedReason = null,
    /// <summary>
    ///     That this parameter measures something, and the unit the READING'S OWN DOCUMENT renders it
    ///     in, so a human surface can stage a bare number with it. Null for anything unmeasurable.
    /// </summary>
    MeasuredDisplayUnit? DisplayUnit = null
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
/// <summary>
///     Open a loaded family from the active project in the family editor and activate it.
///     EditFamily documents have no path and cannot be activated directly, so the family is
///     saved to a scratch .rfa and reopened by path (the proven activation workaround).
/// </summary>
public sealed record FamilyOpenRequest(
    long? FamilyId = null,
    string? FamilyName = null
);

public sealed record FamilyOpenData(
    string FamilyName,
    string DocumentTitle,
    string? SavedPath
);

/// <summary>Caller retains this UUID before submission; reuse it to recover, never open twice.</summary>
public sealed record TemporaryFamilyAcquireRequest(string AcquisitionId, long FamilyId);

/// <summary>Unchanged is the automatic cleanup policy. Discard requires an explicit decision.</summary>
public sealed record TemporaryDocumentReleaseRequest(string AcquisitionId, string ReleaseId, string? ExpectedOpenId = null, bool Discard = false);

public sealed record TemporaryDocumentStatusRequest(string AcquisitionId);
public sealed record TemporaryDocumentRef(string Session, string OpenId);
public sealed record TemporaryDocumentData(string AcquisitionId, string Status, TemporaryDocumentRef? Document,
    string RecoveryId, string? Detail, string? RecordedOpenId, string? RecordedStatus);
