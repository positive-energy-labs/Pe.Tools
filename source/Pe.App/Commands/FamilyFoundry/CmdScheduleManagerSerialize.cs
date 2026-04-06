using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Revit.Global.Revit.Lib.Schedules.Fields;
using Pe.Revit.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Revit.Global.Revit.Ui;
using Pe.Shared.StorageRuntime.Revit;
using Pe.Shared.StorageRuntime.Revit.Core.Json.ContractResolvers;
using Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;
using Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Revit;
using Pe.Shared.StorageRuntime.Revit.Core.Json.ContractResolvers;
using Pe.Shared.StorageRuntime.Revit.Core.Json.SchemaProviders;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdScheduleManagerSerialize : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var storage = RuntimeStorageClient.Default.Module("Schedule Manager");

            // Collect all schedules in the document
            var serializeItems = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSchedule))
                .Cast<ViewSchedule>()
                .Where(s => !s.Name.Contains("<Revision Schedule>"))
                .OrderBy(s => s.Name)
                .Select(s => new ScheduleSerializePaletteItem(s))
                .ToList();

            // Create preview panel with injected preview building logic
            var previewPanel = new ScheduleSerializePreviewPanel((item, _) => {
                if (item == null) return null;
                var serializeItem = (ScheduleSerializePaletteItem)item;
                return this.BuildSerializationPreview(serializeItem);
            });

            // Create the palette
            var window = PaletteFactory.Create("Schedule Serializer",
                new PaletteOptions<ScheduleSerializePaletteItem> {
                    Persistence = (storage, item => item.TextPrimary),
                    SidebarPanel = previewPanel,
                    Tabs = [
                        new TabDefinition<ScheduleSerializePaletteItem>(
                            "All",
                            () => serializeItems,
                            new PaletteAction<ScheduleSerializePaletteItem> {
                                Name = "Serialize", Execute = item => this.HandleSerialize(storage, item)
                            }
                        ) { FilterKeySelector = i => i.TextPill ?? string.Empty }
                    ]
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private ScheduleSerializePreviewData BuildSerializationPreview(ScheduleSerializePaletteItem serializeItem) {
        try {
            // Serialize the schedule to get the spec
            var spec = ScheduleHelper.SerializeSchedule(serializeItem.Schedule);

            // Serialize to JSON exactly as it would be saved
            var profileJson = JsonConvert.SerializeObject(
                spec,
                Formatting.Indented,
                new JsonSerializerSettings {
                    NullValueHandling = NullValueHandling.Ignore,
                    ContractResolver = new RevitTypeContractResolver()
                });

            return new ScheduleSerializePreviewData {
                ProfileName = spec.Name,
                CategoryName = CategoryNamesProvider.GetLabelForBuiltInCategory(spec.CategoryName),
                IsItemized = spec.IsItemized,
                Fields = spec.Fields,
                SortGroup = spec.SortGroup,
                ProfileJson = profileJson,
                IsValid = true
            };
        } catch (Exception ex) {
            return new ScheduleSerializePreviewData {
                ProfileName = serializeItem.TextPrimary,
                IsValid = false,
                ErrorMessage = $"Serialization error: {ex.Message}",
                ProfileJson = string.Empty
            };
        }
    }

    private Task HandleSerialize(ModuleStorage storage, IPaletteListItem item) {
        var serializeItem = (ScheduleSerializePaletteItem)item;

        try {
            var serializeOutputDir = storage.Output().SubDir("serialize");
            var spec = ScheduleHelper.SerializeSchedule(serializeItem.Schedule);

            // Prepend timestamp to filename
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
            var filename = serializeOutputDir.Json($"{timestamp}_{spec.Name}.json").Write(spec);

            var balloon = new Ballogger();
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Serialized schedule '{serializeItem.Schedule.Name}' to {filename}");

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

            balloon.Show(() => FileUtils.OpenInDefaultApp(filename), "Open Output File");
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
        }

        return Task.CompletedTask;
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

    public string? TextPill { get; } = schedule.FindParameter("Discipline")?.AsValueString();

    public Func<string> GetTextInfo => () => {
        var category = Category.GetCategory(this.Schedule.Document, this.Schedule.Definition.CategoryId);
        var fieldCount = this.Schedule.Definition.GetFieldCount();
        return $"Id: {this.Schedule.Id}" +
               $"\nCategory: {category?.Name ?? "Unknown"}" +
               $"\nFields: {fieldCount}" +
               $"\nDiscipline: {this.TextPill}";
    };

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;
}

public class ScheduleSerializePreviewData {
    public string ProfileName { get; set; }
    public string? CategoryName { get; set; }
    public bool? IsItemized { get; set; }
    public List<ScheduleFieldSpec>? Fields { get; set; }
    public List<ScheduleSortGroupSpec>? SortGroup { get; set; }
    public string ProfileJson { get; set; }
    public bool IsValid { get; set; }
    public string? ErrorMessage { get; set; }
}
