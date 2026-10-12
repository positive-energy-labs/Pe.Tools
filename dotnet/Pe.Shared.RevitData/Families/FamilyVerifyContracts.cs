namespace Pe.Shared.RevitData.Families;

public sealed record FamilyLookRequest(string OutDir, IReadOnlyList<string>? Types = null, IReadOnlyList<string>? Toggles = null);
public sealed record FamilyLoadTestRequest(string OutDir, IReadOnlyList<string>? Types = null, string? Template = null);
public sealed record FamilyVerifyPoint(double X, double Y, double Z);
public sealed record FamilyVerifyBounds(FamilyVerifyPoint Min, FamilyVerifyPoint Max);
/// <summary>Positions and sizes are inches; normals are unit vectors. Direction is In, Out, Bidirectional, or null when the domain has none.
/// Drives maps a connector parameter (Flow, Width, Voltage...) to the family parameter associated with it; family documents only.</summary>
public sealed record FamilyVerifyConnector(string Domain, string System, FamilyVerifyPoint Origin, FamilyVerifyPoint Normal,
    string Shape, double? Diameter, double? Width, double? Height, string? Direction, IReadOnlyDictionary<string, string>? Drives);
public sealed record FamilyLookElement(long Id, string Kind, string Name, bool Visible, FamilyVerifyBounds? Bounds, FamilyVerifyConnector? Connector);
public sealed record FamilyVerifyImage(string View, string Path);
public sealed record FamilyLookRow(string Type, string State, IReadOnlyList<FamilyLookElement> Elements, IReadOnlyList<FamilyVerifyImage> Images);
public sealed record FamilyLookData(IReadOnlyList<FamilyLookRow> Rows);
public sealed record FamilyLoadDecision(string Family, bool Shared, bool InUse, bool Overwrite);
/// <summary>LoadedIds belong to the scratch project; EmbeddedCount includes non-shared definitions inside the loaded family.</summary>
public sealed record FamilyLoadNested(string Name, int SourceCount, IReadOnlyList<long> LoadedIds, int EmbeddedCount);
public sealed record FamilyLoadInstance(string Type, long? Id, IReadOnlyList<FamilyVerifyConnector> Connectors, string? Error);
public sealed record FamilyLoadFailure(string Severity, string Description, IReadOnlyList<long> FailingElementIds,
    IReadOnlyList<long> AdditionalElementIds, string Resolution);
public sealed record FamilyLoadTestData(string FamilyName, bool SameNameAlreadyExisted, IReadOnlyList<FamilyLoadDecision> LoadDecisions,
    IReadOnlyList<FamilyLoadNested> NestedFamilies, IReadOnlyList<string> DuplicateNames, IReadOnlyList<FamilyLoadInstance> Rows,
    IReadOnlyList<RevitWarningRow> Warnings, IReadOnlyList<FamilyLoadFailure> Failures, IReadOnlyList<FamilyVerifyImage> Images);
