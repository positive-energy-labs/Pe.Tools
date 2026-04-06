using Pe.Global.PolyFill;
using System.ComponentModel;

namespace Pe.Global.Revit.Lib.Schedules.Fields;

/// <summary>
///     Combined parameter specification for combining multiple parameters into a single column
/// </summary>
public class CombinedParameterSpec {
    [Description("The parameter name to include in the combined field (e.g., 'Family', 'Type', 'Mark').")]
    public string ParameterName { get; set; } = string.Empty;

    [Description("Text prefix to display before this parameter value (e.g., 'Family: ' or '#').")]
    public string Prefix { get; set; } = string.Empty;

    [Description("Text suffix to display after this parameter value.")]
    public string Suffix { get; set; } = string.Empty;

    [Description("Separator text between this and the next parameter (e.g., ' / ' or ' - '). Default is ' / '.")]
    public string Separator { get; set; } = " / ";

    /// <summary>
    ///     Serializes a TableCellCombinedParameterData into a CombinedParameterSpec.
    /// </summary>
    public static CombinedParameterSpec SerializeFrom(TableCellCombinedParameterData combinedParam, Document doc) =>
        new() {
            ParameterName = GetParameterNameFromId(doc, combinedParam.ParamId),
            Prefix = combinedParam.Prefix ?? string.Empty,
            Suffix = combinedParam.Suffix ?? string.Empty,
            Separator = combinedParam.Separator ?? " / "
        };

    private static string GetParameterNameFromId(Document doc, ElementId paramId) {
        if (paramId == null || paramId == ElementId.InvalidElementId)
            return string.Empty;

        // Try to get parameter as a built-in parameter
        if (paramId.Value() < 0) {
            var builtInParam = (BuiltInParameter)paramId.Value();
            return LabelUtils.GetLabelFor(builtInParam);
        }

        // Try to get as a parameter element (shared or project parameter)
        var paramElement = doc.GetElement(paramId);
        return paramElement?.Name ?? string.Empty;
    }
}