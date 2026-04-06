using Pe.RevitData.Parameters;

namespace Pe.Global.Revit.Lib.Families.LoadedFamilies.Models;

public sealed record CollectedLoadedFamilyTypeRecord(
    string TypeName
);

public enum CollectedIssueSeverity {
    Info,
    Warning,
    Error
}

public enum CollectedFormulaState {
    None,
    Present,
    NotApplicable,
    Unknown
}

public enum CollectedExcludedParameterReason {
    UnresolvedClassification,
    ProjectObservedBuiltIn
}

public enum CollectedParameterKind {
    Unknown,
    FamilyParameter,
    SharedParameter,
    ProjectParameter,
    ProjectSharedParameter
}

public enum CollectedParameterScope {
    Unresolved,
    Family,
    FamilyAndProjectBinding,
    ProjectBindingOnly
}

public sealed record CollectedIssue(
    string Code,
    CollectedIssueSeverity Severity,
    string Message,
    string? FamilyName = null,
    string? TypeName = null,
    string? ParameterName = null
);

public sealed record CollectedFamilyParameterRecord {
    public long FamilyId { get; init; }
    public string FamilyUniqueId { get; init; } = string.Empty;
    public string FamilyName { get; init; } = string.Empty;
    public string? CategoryName { get; init; }
    public List<string> TypeNames { get; init; } = [];
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public string StorageType { get; init; } = string.Empty;
    public string? DataTypeId { get; init; }
    public string? DataTypeLabel { get; init; }
    public string? GroupTypeId { get; init; }
    public string? GroupTypeLabel { get; init; }
    public CollectedParameterKind Kind { get; init; } = CollectedParameterKind.Unknown;
    public CollectedParameterScope Scope { get; init; } = CollectedParameterScope.Unresolved;
    public CollectedFormulaState FormulaState { get; init; }
    public string? Formula { get; init; }
    public Dictionary<string, string?> ValuesByType { get; init; } = new(StringComparer.Ordinal);
    public CollectedExcludedParameterReason? ExcludedReason { get; init; }

    public string Name => this.Identity.Name;
    public string? SharedGuid => this.Identity.SharedGuid?.ToString("D");
    public bool IsBuiltIn => this.Identity.BuiltInParameterId.HasValue;
}

public sealed record CollectedLoadedFamilyRecord {
    public long FamilyId { get; init; }
    public string FamilyUniqueId { get; init; } = string.Empty;
    public string FamilyName { get; init; } = string.Empty;
    public string? CategoryName { get; init; }
    public int PlacedInstanceCount { get; init; }
    public List<CollectedLoadedFamilyTypeRecord> Types { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public List<CollectedFamilyParameterRecord> Parameters { get; init; } = [];
    public List<CollectedIssue> Issues { get; init; } = [];
}

public sealed record CollectedProjectParameterBindingRecord {
    public required RevitParameterIdentity Identity { get; init; }
    public string BindingKind { get; init; } = string.Empty;
    public string? DataTypeId { get; init; }
    public string? DataTypeLabel { get; init; }
    public string? GroupTypeId { get; init; }
    public string? GroupTypeLabel { get; init; }
    public List<string> CategoryNames { get; init; } = [];

    public string Name => this.Identity.Name;
}
