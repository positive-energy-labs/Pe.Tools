namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Parameter and lookup-table state captured from one family for the operations library
///     (pre/post diffs, `ProcessingResultBuilder`). Geometry is NOT here: the portable geometric truth is
///     <c>Document.CaptureFamilyModel()</c>.
/// </summary>
public class FamilySnapshot {
    public string FamilyName { get; init; } = string.Empty;

    /// <summary>Parameter snapshots with source tracking.</summary>
    public CapturedCollection<ParameterSnapshot>? Parameters { get; set; }

    /// <summary>Embedded family lookup tables captured as portable table definitions.</summary>
    public CapturedCollection<LookupTableDefinition>? LookupTables { get; set; }
}
