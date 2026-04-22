using Pe.Revit.DocumentData.Schedules.Runtime.Fields;
using Pe.Revit.DocumentData.Schedules.Runtime.Filters;
using Pe.Revit.DocumentData.Schedules.Runtime.SortGroup;
using Pe.Revit.DocumentData.Schedules.Runtime.TitleStyle;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.DocumentData.Schedules.Runtime;

public class OnFinishSettings {
    [Description("Automatically open the schedule when the command completes")]
    public bool OpenScheduleOnFinish { get; set; } = true;
}

public class ScheduleProfile {
    [Description("The name of the schedule as it will appear in the project browser.")]
    [Required]
    public string Name { get; set; } = string.Empty;

    [Description("The built-in Revit category to schedule (for example 'Mechanical Equipment' or 'Doors').")]
    [Required]
    public BuiltInCategory CategoryName { get; set; } = BuiltInCategory.INVALID;

    [Description(
        "The name of the view template to apply to this schedule. Leave empty to use no template. Must be a schedule-compatible view template.")]
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
    [Required]
    public List<ScheduleFieldSpec> Fields { get; set; } = [];

    [Description("List of sort and grouping criteria for organizing schedule rows.")]
    public List<ScheduleSortGroupSpec> SortGroup { get; set; } = [];

    [Description("List of filters to restrict which elements appear in the schedule. Maximum of 8 filters.")]
    public List<ScheduleFilterSpec> Filters { get; set; } = [];

    [Description("Settings for what to do when the command completes")]
    public OnFinishSettings? OnFinishSettings { get; set; } = new();
}


