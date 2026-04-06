using System.ComponentModel;

namespace Pe.Global.Revit.Lib.Schedules;

/// <summary>
///     Type of calculated field
/// </summary>
public enum CalculatedFieldType {
    [Description("A calculated field using a formula expression.")]
    Formula,

    [Description("A calculated field showing percentage of another field.")]
    Percentage
}