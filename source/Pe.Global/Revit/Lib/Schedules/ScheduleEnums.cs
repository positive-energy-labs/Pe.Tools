using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib.Schedules;

/// <summary>
///     Type of calculated field
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CalculatedFieldType {
    [Description("A calculated field using a formula expression.")]
    Formula,

    [Description("A calculated field showing percentage of another field.")]
    Percentage
}

