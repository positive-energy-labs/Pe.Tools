using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Global.Services.Storage;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdSerializeSchedule : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            var doc = uiapp.ActiveUIDocument.Document;

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(s => !s.Name.Contains("<Revision Schedule>"))
                .OrderBy(s => s.Name)
                .Select(s => new ScheduleSerializePaletteItem(s));

            var actions = new List<PaletteAction<ScheduleSerializePaletteItem>> {
                new() {
                    Name = "Serialize",
                    Execute = item => {
                        try {
                            var storage = new Storage("Schedule Manager");
                            var outputDir = storage.OutputDir();
                            var spec = ScheduleHelper.SerializeSchedule(item.Schedule);
                            var filename = outputDir.Json($"{spec.Name}.json").Write(spec);

                            var balloon = new Ballogger();
                            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                                $"Serialized schedule '{item.Schedule.Name}' to {filename}");

                            // Report what was serialized
                            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                                $"Fields: {spec.Fields.Count} ({spec.Fields.Count(f => f.CalculatedType != null)} calculated)");

                            if (spec.SortGroup.Count > 0) {
                                _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                                    $"Sort/Group: {spec.SortGroup.Count}");
                            }

                            if (spec.Filters.Count > 0) {
                                _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                                    $"Filters: {spec.Filters.Count}");
                            }

                            var headerGroupCount = spec.Fields.Count(f => !string.IsNullOrEmpty(f.HeaderGroup));
                            if (headerGroupCount > 0) {
                                var uniqueGroups = spec.Fields
                                    .Where(f => !string.IsNullOrEmpty(f.HeaderGroup))
                                    .Select(f => f.HeaderGroup)
                                    .Distinct()
                                    .Count();
                                _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                                    $"Header Groups: {uniqueGroups} group(s) across {headerGroupCount} field(s)");
                            }

                            balloon.Show();
                        } catch (Exception ex) {
                            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
                        }

                        return Task.CompletedTask;
                    }
                }
            };

            var window = PaletteFactory.Create("Schedule Serializer", items, actions,
                new PaletteOptions<ScheduleSerializePaletteItem> {
                    SearchConfig = SearchConfig.PrimaryAndSecondary(), FilterKeySelector = item => item.TextPill
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}

public class ScheduleSerializePaletteItem(ViewSchedule schedule) : IPaletteListItem {
    public ViewSchedule Schedule { get; } = schedule;
    public string TextPrimary => this.Schedule.Name;

    public string TextSecondary {
        get {
            var category = Category.GetCategory(this.Schedule.Document, this.Schedule.Definition.CategoryId);
            return category?.Name ?? string.Empty;
        }
    }

    public string TextPill { get; } = schedule.FindParameter("Discipline")?.AsValueString();

    public Func<string> GetTextInfo => () => {
        var category = Category.GetCategory(this.Schedule.Document, this.Schedule.Definition.CategoryId);
        var fieldCount = this.Schedule.Definition.GetFieldCount();
        return $"Id: {this.Schedule.Id}" +
               $"\nCategory: {category?.Name ?? "Unknown"}" +
               $"\nFields: {fieldCount}" +
               $"\nDiscipline: {this.TextPill}";
    };

    public BitmapImage Icon => null;
    public Color? ItemColor => null;
}