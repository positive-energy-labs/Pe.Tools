using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.OperationSettings;

public enum LookupTableTransport {
    RevitCsv
}

public enum LookupTableColumnRole {
    LookupKey,
    Value
}

public enum LookupTableLogicalType {
    Text,
    Bool,
    Int,
    Number,
    Length,
    Area,
    Volume,
    Angle,
    Percent
}

public sealed record LookupTableColumn {
    [Description("Column name used in authored lookup-table schemas.")]
    [Required]
    public string Name { get; init; } = string.Empty;

    [Description("Logical value type used for validation and CSV header emission.")]
    [Required]
    public LookupTableLogicalType LogicalType { get; init; } = LookupTableLogicalType.Text;

    [Description("Optional explicit Revit header type token preserved during capture and reused during CSV emission.")]
    public string? RevitTypeToken { get; init; }

    [Description("Whether this column participates in key matching or returns a looked-up value.")]
    [Required]
    public LookupTableColumnRole Role { get; init; } = LookupTableColumnRole.Value;

    [Description("Optional explicit Revit header unit token preserved during capture and reused during CSV emission.")]
    public string? UnitToken { get; init; }
}

public sealed record LookupTableSchema {
    [Description("Embedded family lookup-table name.")]
    [Required]
    public string Name { get; init; } = string.Empty;

    [Description("CSV transport used when emitting the lookup table into Revit.")]
    [Required]
    public LookupTableTransport Transport { get; init; } = LookupTableTransport.RevitCsv;

    [Description("Ordered schema columns excluding the unlabeled row-name column emitted at CSV index 0.")]
    [Required]
    public List<LookupTableColumn> Columns { get; init; } = [];
}

public sealed record LookupTableRow {
    [Description("Optional row label emitted into the unlabeled first CSV column.")]
    [Required]
    public string RowName { get; init; } = string.Empty;

    [Description("Cell values keyed by authored schema column name.")]
    [Required]
    public Dictionary<string, string> ValuesByColumn { get; init; } = new(StringComparer.Ordinal);
}

public sealed class LookupTableDefinition {
    [Description("Authored lookup-table schema.")]
    [Required]
    public LookupTableSchema Schema { get; init; } = new();

    [Description("Ordered lookup-table rows.")]
    [Required]
    public List<LookupTableRow> Rows { get; init; } = [];
}

public sealed class SetLookupTablesSettings : IOperationSettings {
    [Description("Remove an existing family lookup table before importing a table with the same name.")]
    public bool ReplaceExisting { get; init; } = true;

    [Description("Authored lookup tables to emit as Revit CSV and import into the family.")]
    [Required]
    public List<LookupTableDefinition> Tables { get; init; } = [];

    public bool Enabled { get; init; } = true;
}
