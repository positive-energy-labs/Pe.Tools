using System.Windows.Media;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Pe.App.Commands.Schedules.Ui;
using Pe.Revit.DocumentData.Schedules;
using Pe.Revit.Global.Ui;
using Pe.App.Host;
using Pe.App.Pods;
using Pe.Revit.Scripting.Pods;
using System.IO;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;
using Color = System.Windows.Media.Color;
using SharedScheduleFieldSpec = Pe.Shared.RevitData.Schedules.ScheduleFieldSpec;
using SharedScheduleSortGroupSpec = Pe.Shared.RevitData.Schedules.ScheduleSortGroupSpec;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;

namespace Pe.App.Commands.Schedules;

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
            var storage = RuntimeStorageClient.Default.Module(ScheduleManagerSettingsRegistration.ModuleKey);

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

            // One capture action per installed pod: capture always writes a new member into the chosen pod.
            var captureActions = PodMembers.Pods().Select(pod => new PaletteAction<ScheduleSerializePaletteItem> {
                Name = $"Capture into {pod.Manifest.Name}", Execute = item => HandleCapture(pod.Manifest.Id, item)
            }).ToArray();
            if (captureActions.Length == 0)
                throw new InvalidOperationException("No installed pod to capture into.");

            var window = PaletteFactory.Create("Schedule Capture",
                new PaletteOptions<ScheduleSerializePaletteItem> {
                    Persistence = (Storage: storage, PersistenceKey: item => item.TextPrimary),
                    SidebarPanel = previewPanel,
                    Tabs = [
                        new TabDefinition<ScheduleSerializePaletteItem>(
                            "All",
                            () => serializeItems,
                            captureActions
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
            var profile = serializeItem.Schedule.CaptureAuthoredScheduleProfile();
            var profileJson = ScheduleBridgeOps.CaptureSpec(serializeItem.Schedule);

            return new ScheduleSerializePreviewData {
                ProfileName = profile.Name,
                CategoryName = profile.CategoryName,
                IsItemized = profile.IsItemized,
                Fields = profile.Fields ?? [],
                SortGroup = profile.SortGroup ?? [],
                ProfileJson = profileJson,
                IsValid = true
            };
        } catch (Exception ex) {
            return new ScheduleSerializePreviewData {
                ProfileName = serializeItem.TextPrimary,
                IsValid = false,
                ErrorMessage = $"Capture error: {ex.Message}",
                ProfileJson = string.Empty
            };
        }
    }

    private static Task HandleCapture(string podId, ScheduleSerializePaletteItem item) {
        try {
            var spec = ScheduleBridgeOps.CaptureSpec(item.Schedule);
            var path = $"settings/schedules/{string.Concat(item.Schedule.Name.Split(Path.GetInvalidFileNameChars()))}-{DateTime.Now:yyyyMMdd-HHmmss}.json";
            var pods = new ScriptPodPreparationService();
            _ = pods.WriteMember(podId, path, spec);
            var fullPath = Path.Combine(pods.ResolveFolder(podId), path);
            new Ballogger()
                .Add(LogEventLevel.Information, new StackFrame(), $"Captured schedule '{item.Schedule.Name}' as {podId}:{path}")
                .Show(() => FileUtils.OpenInDefaultApp(fullPath), "Open Member");
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

    public ImageSource? Icon => null;
    public Color? ItemColor => null;
}

public class ScheduleSerializePreviewData {
    public string ProfileName { get; set; } = string.Empty;
    public string? CategoryName { get; set; }
    public bool? IsItemized { get; set; }
    public List<SharedScheduleFieldSpec> Fields { get; set; } = [];
    public List<SharedScheduleSortGroupSpec> SortGroup { get; set; } = [];
    public string ProfileJson { get; set; } = string.Empty;
    public bool IsValid { get; set; }
    public string? ErrorMessage { get; set; }
}
