using Pe.Global.Revit.Lib.Schedules.Fields;
using Pe.Global.Revit.Lib.Schedules.Filters;
using Pe.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Global.Revit.Lib.Schedules.TitleStyle;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Global.Revit.Lib.Schedules;

public class OnFinishSettings {
    [Description("Automatically open the schedule when the command completes")]
    public bool OpenScheduleOnFinish { get; set; } = true;
}

public class ScheduleSpec {
    [Description("The name of the schedule as it will appear in the project browser.")]
    [Required]
    public string Name { get; set; } = string.Empty;

    [Description("The Revit category to schedule (e.g., 'Mechanical Equipment', 'Plumbing Fixtures', 'Doors').")]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    [Required]
    public string CategoryName { get; set; } = string.Empty;

    [Description(
        "The name of the view template to apply to this schedule. Leave empty to use no template. Must be a schedule-compatible view template.")]
    [SchemaExamples(typeof(ScheduleViewTemplateNamesProvider))]
    public string? ViewTemplateName { get; set; }

    [Description(
        "Style settings for the schedule title cell, including borders and text alignment. Must be applied before view template. Leave null to skip title styling.")]
    public ScheduleTitleStyleSpec TitleStyle { get; set; } = new();

    [Description(
        "Whether the schedule displays each element on a separate row (true) or combines multiple grouped elements onto the same row (false).")]
    public bool IsItemized { get; set; } = true;

    [Description(
        "When true, if the schedule is placed on a sheet, it will only show elements visible in the viewports on that sheet. Not all categories support this feature.")]
    public bool FilterBySheet { get; set; } = false;

    [Description("List of fields (columns) to include in the schedule.")]
    [Includable("fields")]
    [Required]
    public List<ScheduleFieldSpec> Fields { get; set; } = [];

    [Description("List of sort and grouping criteria for organizing schedule rows.")]
    public List<ScheduleSortGroupSpec> SortGroup { get; set; } = [];

    [Description("List of filters to restrict which elements appear in the schedule. Maximum of 8 filters.")]
    public List<ScheduleFilterSpec> Filters { get; set; } = [];
    
    [Description("Settings for what to do when the command completes")]
    public OnFinishSettings? OnFinishSettings { get; set; } = new();
}

/// <summary>
///     Provides line style names from the active Revit document for JSON schema examples.
///     Used to enable LSP autocomplete for line style name properties.
///     Returns common default line styles if no document is available.
/// </summary>
public class LineStyleNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument) {
                // Return common default Revit line styles
                return [
                    "Thin Lines",
                    "Medium Lines",
                    "Wide Lines",
                    "Heavy Line",
                    "<Invisible lines>"
                ];
            }

            var lineCategory = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            if (lineCategory == null) {
                return [
                    "Thin Lines",
                    "Medium Lines",
                    "Wide Lines",
                    "Heavy Line"
                ];
            }

            var lineStyles = new List<string>();
            foreach (Category subCategory in lineCategory.SubCategories) {
                if (!string.IsNullOrWhiteSpace(subCategory.Name))
                    lineStyles.Add(subCategory.Name);
            }

            return lineStyles.OrderBy(name => name);
        } catch {
            // No document available or error - return common defaults
            return [
                "Thin Lines",
                "Medium Lines",
                "Wide Lines",
                "Heavy Line",
                "<Invisible lines>"
            ];
        }
    }
}