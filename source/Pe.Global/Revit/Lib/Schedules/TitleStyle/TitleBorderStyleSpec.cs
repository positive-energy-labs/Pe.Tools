using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using System.ComponentModel;

namespace Pe.Global.Revit.Lib.Schedules.TitleStyle;

/// <summary>
///     Specification for individual border edges on a schedule title cell.
/// </summary>
public class TitleBorderStyleSpec {
    [Description(
        "Line style name for the top border (matches Line Styles in project). Leave null to not apply a top border.")]
    [SchemaExamples(typeof(LineStyleNamesProvider))]
    public string? TopLineStyleName { get; set; }

    [Description(
        "Line style name for the bottom border (matches Line Styles in project). Leave null to not apply a bottom border.")]
    [SchemaExamples(typeof(LineStyleNamesProvider))]
    public string? BottomLineStyleName { get; set; } = "Medium Lines";

    [Description(
        "Line style name for the left border (matches Line Styles in project). Leave null to not apply a left border.")]
    [SchemaExamples(typeof(LineStyleNamesProvider))]
    public string? LeftLineStyleName { get; set; }

    [Description(
        "Line style name for the right border (matches Line Styles in project). Leave null to not apply a right border.")]
    [SchemaExamples(typeof(LineStyleNamesProvider))]
    public string? RightLineStyleName { get; set; }

    /// <summary>
    ///     Applies border styles to the provided TableCellStyle.
    ///     Returns tuple of (bool applied, List warnings).
    /// </summary>
    internal (bool Applied, List<string> Warnings) ApplyTo(
        Document doc,
        TableCellStyle cellStyle,
        TableCellStyleOverrideOptions overrideOptions) {
        var warnings = new List<string>();
        var anyApplied = false;

        // Apply top border (or explicitly remove it)
        if (!string.IsNullOrWhiteSpace(this.TopLineStyleName)) {
            var lineStyleId = FindLineStyleIdByName(doc, this.TopLineStyleName);
            if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
                overrideOptions.BorderTopLineStyle = true;
                cellStyle.BorderTopLineStyle = lineStyleId;
                anyApplied = true;
            } else
                warnings.Add($"Top line style '{this.TopLineStyleName}' not found.");
        } else {
            // Explicitly set to invisible/no border
            overrideOptions.BorderTopLineStyle = true;
            cellStyle.BorderTopLineStyle = ElementId.InvalidElementId;
            anyApplied = true;
        }

        // Apply bottom border (or explicitly remove it)
        if (!string.IsNullOrWhiteSpace(this.BottomLineStyleName)) {
            var lineStyleId = FindLineStyleIdByName(doc, this.BottomLineStyleName);
            if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
                overrideOptions.BorderBottomLineStyle = true;
                cellStyle.BorderBottomLineStyle = lineStyleId;
                anyApplied = true;
            } else
                warnings.Add($"Bottom line style '{this.BottomLineStyleName}' not found.");
        } else {
            // Explicitly set to invisible/no border
            overrideOptions.BorderBottomLineStyle = true;
            cellStyle.BorderBottomLineStyle = ElementId.InvalidElementId;
            anyApplied = true;
        }

        // Apply left border (or explicitly remove it)
        if (!string.IsNullOrWhiteSpace(this.LeftLineStyleName)) {
            var lineStyleId = FindLineStyleIdByName(doc, this.LeftLineStyleName);
            if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
                overrideOptions.BorderLeftLineStyle = true;
                cellStyle.BorderLeftLineStyle = lineStyleId;
                anyApplied = true;
            } else
                warnings.Add($"Left line style '{this.LeftLineStyleName}' not found.");
        } else {
            // Explicitly set to invisible/no border
            overrideOptions.BorderLeftLineStyle = true;
            cellStyle.BorderLeftLineStyle = ElementId.InvalidElementId;
            anyApplied = true;
        }

        // Apply right border (or explicitly remove it)
        if (!string.IsNullOrWhiteSpace(this.RightLineStyleName)) {
            var lineStyleId = FindLineStyleIdByName(doc, this.RightLineStyleName);
            if (lineStyleId != null && lineStyleId != ElementId.InvalidElementId) {
                overrideOptions.BorderRightLineStyle = true;
                cellStyle.BorderRightLineStyle = lineStyleId;
                anyApplied = true;
            } else
                warnings.Add($"Right line style '{this.RightLineStyleName}' not found.");
        } else {
            // Explicitly set to invisible/no border
            overrideOptions.BorderRightLineStyle = true;
            cellStyle.BorderRightLineStyle = ElementId.InvalidElementId;
            anyApplied = true;
        }

        return (anyApplied, warnings);
    }

    private static ElementId? FindLineStyleIdByName(Document doc, string lineStyleName) {
        var lineCategory = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
        if (lineCategory == null) return null;

        foreach (Category subCategory in lineCategory.SubCategories) {
            if (!subCategory.Name.Equals(lineStyleName, StringComparison.OrdinalIgnoreCase))
                continue;

            var graphicsStyle = subCategory.GetGraphicsStyle(GraphicsStyleType.Projection);
            return graphicsStyle?.Id;
        }

        return null;
    }
}