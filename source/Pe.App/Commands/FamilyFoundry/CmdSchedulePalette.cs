using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.Global.Revit.Lib.Schedules;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;
using Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;
using Pe.Ui.Core;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdSchedulePalette : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var storage = new Storage("Schedule Manager");
            var settingsManager = storage.SettingsDir();
            var schedulesSubDir = settingsManager.SubDir("schedules");
            var batchSubDir = settingsManager.SubDir("batch");

            // Context for Schedule tabs
            var context = new ScheduleManagerContext {
                Doc = doc,
                UiDoc = uiDoc,
                Storage = storage,
                SettingsManager = settingsManager
            };

            // Collect items for both tabs
            var createItems = ScheduleListItem.DiscoverProfiles(schedulesSubDir);
            var batchItems = BatchScheduleListItem.DiscoverProfiles(batchSubDir);

            // Combine all items
            var allItems = new List<ISchedulePaletteItem>();
            allItems.AddRange(createItems.Select(i => new SchedulePaletteItemWrapper(i, ScheduleTabType.Create)));
            allItems.AddRange(batchItems.Select(i => new SchedulePaletteItemWrapper(i, ScheduleTabType.Batch)));

            // Create preview panel
            var previewPanel = new SchedulePreviewPanel();

            // Define actions for the palette
            var actions = new List<PaletteAction<ISchedulePaletteItem>> {
                new() {
                    Name = "Create Schedule",
                    Execute = async item => this.HandleCreateSchedule(context, item),
                    CanExecute = item => item.TabType == ScheduleTabType.Create && context.PreviewData?.IsValid == true
                },
                new() {
                    Name = "Place Sample Families",
                    Execute = async item => this.HandlePlaceSampleFamilies(context, item),
                    CanExecute = item => item.TabType == ScheduleTabType.Create && context.SelectedProfile != null
                },
                new() {
                    Name = "Open File",
                    Execute = async item => this.HandleOpenFile(item),
                    CanExecute = item => item.TabType == ScheduleTabType.Create && context.SelectedProfile != null
                },
                new() {
                    Name = "Run Batch",
                    Execute = async item => this.HandleRunBatch(context, item),
                    CanExecute = item => item.TabType == ScheduleTabType.Batch && item.GetBatchItem() != null
                }
            };

            // Create the palette with tabs
            var window = PaletteFactory.Create("Schedule Manager", allItems, actions,
                new PaletteOptions<ISchedulePaletteItem> {
                    Storage = storage,
                    PersistenceKey = item => item.TextPrimary,
                    Tabs = [
                        new TabDefinition<ISchedulePaletteItem> {
                            Name = "Create",
                            Filter = i => i.TabType == ScheduleTabType.Create,
                            FilterKeySelector = i => i.CategoryName
                        },
                        new TabDefinition<ISchedulePaletteItem> {
                            Name = "Batch",
                            Filter = i => i.TabType == ScheduleTabType.Batch,
                            FilterKeySelector = i => string.Empty
                        }
                    ],
                    DefaultTabIndex = 0,
                    Sidebar = new PaletteSidebar { Content = previewPanel },
                    OnSelectionChangedDebounced = item => {
                        if (item == null) return;
                        if (item.TabType == ScheduleTabType.Create) {
                            this.BuildPreviewData(item.GetCreateItem(), context);
                            if (context.PreviewData != null)
                                previewPanel.UpdatePreview(context.PreviewData);
                        } else if (item.TabType == ScheduleTabType.Batch) {
                            var batchItem = item.GetBatchItem();
                            if (batchItem != null) {
                                var previewData = this.BuildBatchPreview(batchItem);
                                previewPanel.UpdatePreview(previewData);
                            } else
                                previewPanel.UpdatePreview(null);
                        }
                    }
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void BuildPreviewData(ScheduleListItem profileItem, ScheduleManagerContext context) {
        if (profileItem == null) {
            context.PreviewData = null;
            return;
        }

        // Check cache first
        if (context.PreviewCache.TryGetValue(profileItem.TextPrimary, out var cachedPreview)) {
            context.PreviewData = cachedPreview;
            context.SelectedProfile = profileItem;
            return;
        }

        context.SelectedProfile = profileItem;
        context.PreviewData = this.TryLoadPreviewData(profileItem, context);
        context.PreviewCache[profileItem.TextPrimary] = context.PreviewData;
    }

    private SchedulePreviewData TryLoadPreviewData(ScheduleListItem profileItem, ScheduleManagerContext context) {
        try {
            return this.LoadValidPreviewData(profileItem, context);
        } catch (JsonValidationException ex) {
            return CreateValidationErrorPreview(profileItem, ex);
        } catch (JsonSanitizationException ex) {
            return CreateSanitizationErrorPreview(profileItem, ex);
        } catch (Exception ex) {
            return CreateGenericErrorPreview(profileItem, ex);
        }
    }

    private SchedulePreviewData LoadValidPreviewData(ScheduleListItem profileItem, ScheduleManagerContext context) {
        // Load the profile
        var profile = context.SettingsManager.SubDir("schedules")
            .Json<ScheduleSpec>($"{profileItem.TextPrimary}.json")
            .Read();

        // Serialize profile to JSON
        var profileJson = JsonSerializer.Serialize(
            profile,
            new JsonSerializerOptions {
                WriteIndented = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            });

        return new SchedulePreviewData {
            ProfileName = profileItem.TextPrimary,
            CategoryName = profile.CategoryName,
            IsItemized = profile.IsItemized,
            Fields = profile.Fields,
            SortGroup = profile.SortGroup,
            ProfileJson = profileJson,
            FilePath = profileItem.FilePath,
            CreatedDate = profileItem._fileInfo.CreationTime,
            ModifiedDate = profileItem._fileInfo.LastWriteTime,
            ViewTemplateName = profile.ViewTemplateName ?? string.Empty,
            IsValid = true
        };
    }

    private static SchedulePreviewData CreateValidationErrorPreview(ScheduleListItem profileItem,
        JsonValidationException ex) =>
        new() { ProfileName = profileItem.TextPrimary, IsValid = false, RemainingErrors = ex.ValidationErrors };

    private static SchedulePreviewData
        CreateSanitizationErrorPreview(ScheduleListItem profileItem, JsonSanitizationException ex) {
        var preview = new SchedulePreviewData {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            RemainingErrors = []
        };

        if (ex.AddedProperties.Any())
            preview.RemainingErrors.Add($"Added properties: {string.Join(", ", ex.AddedProperties)}");

        if (ex.RemovedProperties.Any())
            preview.RemainingErrors.Add($"Removed properties: {string.Join(", ", ex.RemovedProperties)}");

        return preview;
    }

    private static SchedulePreviewData CreateGenericErrorPreview(ScheduleListItem profileItem, Exception ex) =>
        new() {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            RemainingErrors = [$"{ex.GetType().Name}: {ex.Message}"]
        };

    private SchedulePreviewData BuildBatchPreview(BatchScheduleListItem batchItem) {
        try {
            var batchSettings = batchItem.LoadBatchSettings();

            // Build a summary preview showing all schedules that will be created
            var schedulesList = string.Join("\n", batchSettings.ScheduleFiles.Select((path, idx) => $"{idx + 1}. {path}"));
            var profileJson = $"Batch will create {batchSettings.ScheduleFiles.Count} schedule(s):\n\n{schedulesList}";

            return new SchedulePreviewData {
                ProfileName = batchItem.TextPrimary,
                CategoryName = "Batch Operation",
                IsItemized = true,
                Fields = [],
                SortGroup = [],
                ProfileJson = profileJson,
                FilePath = batchItem.FilePath,
                CreatedDate = batchItem.CreatedDate,
                ModifiedDate = batchItem.LastModified,
                ViewTemplateName = string.Empty,
                IsValid = true
            };
        } catch (Exception ex) {
            return new SchedulePreviewData {
                ProfileName = batchItem.TextPrimary,
                IsValid = false,
                RemainingErrors = [$"Batch preview error: {ex.Message}"]
            };
        }
    }

    private void HandleCreateSchedule(ScheduleManagerContext ctx, ISchedulePaletteItem item) {
        var profileItem = item.GetCreateItem();
        if (profileItem == null) return;

        // Update context with selected profile
        this.BuildPreviewData(profileItem, ctx);

        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot create schedule - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        ScheduleSpec scheduleSpec;
        try {
            scheduleSpec = ctx.SettingsManager.SubDir("schedules")
                .Json<ScheduleSpec>($"{ctx.SelectedProfile.TextPrimary}.json")
                .Read();
        } catch (Exception ex) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), ex, true)
                .Show();
            return;
        }

        ScheduleCreationResult result;
        try {
            using var trans = new Transaction(ctx.Doc, "Create Schedule");
            _ = trans.Start();
            result = ScheduleHelper.CreateSchedule(ctx.Doc, scheduleSpec);
            _ = trans.Commit();
        } catch (Exception ex) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), ex, true)
                .Show();
            return;
        }

        // Write output to storage
        var outputPath = this.WriteCreationOutput(ctx, result);
        if (string.IsNullOrEmpty(outputPath)) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Failed to write creation output")
                .Show();
            return;
        }

        // Build comprehensive balloon message
        var hasIssues = result.SkippedCalculatedFields.Count > 0 ||
                        result.SkippedFields.Count > 0 ||
                        result.SkippedSortGroups.Count > 0 ||
                        result.SkippedFilters.Count > 0 ||
                        result.SkippedHeaderGroups.Count > 0 ||
                        !string.IsNullOrEmpty(result.SkippedViewTemplate) ||
                        result.Warnings.Count > 0;

        var hasHeaderGroups = result.AppliedHeaderGroups.Count > 0 || result.SkippedHeaderGroups.Count > 0;
        var headerGroupCount = result.AppliedHeaderGroups.Count + result.SkippedHeaderGroups.Count;
        var hasFields = result.AppliedFields.Count > 0 || result.SkippedFields.Count > 0;
        var fieldCount = result.AppliedFields.Count + result.SkippedFields.Count;
        var hasSortGroups = result.AppliedSortGroups.Count > 0 || result.SkippedSortGroups.Count > 0;
        var sortGroupCount = result.AppliedSortGroups.Count + result.SkippedSortGroups.Count;
        var hasFilters = result.AppliedFilters.Count > 0 || result.SkippedFilters.Count > 0;
        var filterCount = result.AppliedFilters.Count + result.SkippedFilters.Count;
        var hasAppliedViewTemplate =
            !string.IsNullOrEmpty(scheduleSpec.ViewTemplateName) && result.AppliedViewTemplate != null;
        var viewTemplateCount = result.AppliedViewTemplate != null ? 1 : 0;
        var viewTemplateSkippedCount = result.SkippedViewTemplate != null ? 1 : 0;
        var hasCalculatedFields = result.SkippedCalculatedFields.Count > 0;
        var calculatedFieldCount = result.SkippedCalculatedFields.Count;
        var hasWarnings = result.Warnings.Count > 0;

        new Ballogger()
            .Add(LogEventLevel.Information, null,
                $"Created schedule '{result.ScheduleName}' from profile '{ctx.SelectedProfile.TextPrimary}'")
            .AddIf(hasIssues, LogEventLevel.Warning, null,
                "THERE WERE ISSUES WITH THE SCHEDULE CREATION. SEE THE OUTPUT FILE FOR DETAILS.")
            .AddIf(hasCalculatedFields, LogEventLevel.Warning, null,
                $"{calculatedFieldCount} calculated field(s) require manual creation - see output file")
            .AddIf(hasHeaderGroups, LogEventLevel.Information, null,
                $"Field header(s) applied: {result.AppliedHeaderGroups.Count} / {headerGroupCount} ")
            .AddIf(hasFields, LogEventLevel.Information, null,
                $"Field(s) applied: {result.AppliedFields.Count} / {fieldCount} ")
            .AddIf(hasSortGroups, LogEventLevel.Information, null,
                $"Sort/group(s) applied: {result.AppliedSortGroups.Count} / {sortGroupCount} ")
            .AddIf(hasFilters, LogEventLevel.Information, null,
                $"Filter(s) applied: {result.AppliedFilters.Count} / {filterCount} ")
            .AddIf(hasAppliedViewTemplate, LogEventLevel.Information, null,
                $"View template applied: {result.AppliedViewTemplate}")
            .AddIf(!string.IsNullOrEmpty(scheduleSpec.ViewTemplateName) && result.AppliedViewTemplate == null,
                LogEventLevel.Warning, null,
                $"View template skipped: {result.SkippedViewTemplate}")
            .AddIf(hasWarnings, LogEventLevel.Warning, null, "Warnings:")
            .AddIf(hasWarnings, LogEventLevel.Warning, null,
                string.Join("\n", result.Warnings.Select(w => $"  • {w}")))
            .Show(() => FileUtils.OpenInDefaultApp(outputPath), "Open Output File");


        // Open the schedule view
        // if (scheduleSpec.OnFinish.OpenScheduleOnFinish) {
        //     ctx.UiDoc.ActiveView = result.Schedule;
        // }
    }

    private void HandlePlaceSampleFamilies(ScheduleManagerContext context, ISchedulePaletteItem item) {
        var profileItem = item.GetCreateItem();
        if (profileItem == null) return;

        // Update context with selected profile
        this.BuildPreviewData(profileItem, context);

        var profile = context.SettingsManager.SubDir("schedules")
            .Json<ScheduleSpec>($"{context.SelectedProfile.TextPrimary}.json")
            .Read();

        // Get families of the schedule's category
        var category = context.Doc.Settings.Categories.get_Item(profile.CategoryName);

        if (category == null) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Category '{profile.CategoryName}' not found")
                .Show();
            return;
        }

        var allFamilies = new FilteredElementCollector(context.Doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => f.FamilyCategory?.Id == category.Id)
            .ToList();

        if (allFamilies.Count == 0) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(),
                    $"No {profile.CategoryName} families found in the project")
                .Show();
            return;
        }

        // Use Revit's native schedule filtering to find families that match the profile's filters
        var matchingFamilyNames = ScheduleHelper.GetFamiliesMatchingFilters(
            context.Doc,
            profile,
            allFamilies);

        if (matchingFamilyNames.Count == 0) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), "No families match the schedule filters")
                .Show();
            return;
        }

        FamilyPlacementHelper.PromptAndPlaceFamilies(
            context.UiDoc.Application,
            matchingFamilyNames,
            "Schedule Manager");
    }

    private void HandleOpenFile(ISchedulePaletteItem item) {
        var profileItem = item.GetCreateItem();
        if (profileItem == null) return;

        var filePath = profileItem.FilePath;
        if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Profile file not found: {filePath}")
                .Show();
            return;
        }

        FileUtils.OpenInDefaultApp(filePath);
    }

    private void HandleRunBatch(ScheduleManagerContext context, ISchedulePaletteItem item) {
        var batchItem = item.GetBatchItem();
        if (batchItem == null) return;

        try {
            var batchSettings = batchItem.LoadBatchSettings();
            var schedulesSubDir = context.SettingsManager.SubDir("schedules");
            var results = new List<(string profileName, bool success, string errorMessage)>();
            var createdSchedules = new List<string>();

            foreach (var scheduleFile in batchSettings.ScheduleFiles) {
                try {
                    // Load the schedule spec
                    var scheduleFilePath = Path.Combine(schedulesSubDir.DirectoryPath, scheduleFile);
                    if (!File.Exists(scheduleFilePath)) {
                        results.Add((scheduleFile, false, "File not found"));
                        continue;
                    }

                    var scheduleSpec = schedulesSubDir.Json<ScheduleSpec>(scheduleFile).Read();

                    // Create the schedule
                    using var trans = new Transaction(context.Doc, $"Create Schedule: {scheduleSpec.Name}");
                    _ = trans.Start();
                    var result = ScheduleHelper.CreateSchedule(context.Doc, scheduleSpec);
                    _ = trans.Commit();

                    results.Add((scheduleFile, true, string.Empty));
                    createdSchedules.Add(result.ScheduleName);

                    // Write output for this schedule
                    _ = this.WriteCreationOutput(context, result, scheduleFile);
                } catch (Exception ex) {
                    results.Add((scheduleFile, false, ex.Message));
                }
            }

            // Show summary balloon
            var balloon = new Ballogger();
            var successCount = results.Count(r => r.success);
            var failCount = results.Count(r => !r.success);

            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Batch Complete: {successCount} succeeded, {failCount} failed");

            if (createdSchedules.Any()) {
                _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                    $"Created schedules:\n{string.Join("\n", createdSchedules.Select(s => $"  • {s}"))}");
            }

            if (failCount > 0) {
                var failures = results.Where(r => !r.success).ToList();
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                    $"Failed schedules:\n{string.Join("\n", failures.Select(f => $"  • {f.profileName}: {f.errorMessage}"))}");
            }

            var outputPath = context.Storage.OutputDir().SubDir("batch").DirectoryPath;
            balloon.Show(() => FileUtils.OpenInDefaultApp(outputPath), "Open Output Folder");
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
        }
    }

    private string WriteCreationOutput(ScheduleManagerContext ctx, ScheduleCreationResult result, string profileName = null) {
        try {
            var createOutputDir = ctx.Storage.OutputDir().SubDir("create");

            var outputData = new {
                result.ScheduleName,
                result.CategoryName,
                result.IsItemized,
                ProfileName = profileName ?? ctx.SelectedProfile?.TextPrimary ?? "Unknown",
                CreatedAt = DateTime.Now,
                Summary =
                    new {
                        AppliedFieldsCount = result.AppliedFields.Count,
                        SkippedFieldsCount = result.SkippedFields.Count,
                        AppliedSortGroupsCount = result.AppliedSortGroups.Count,
                        SkippedSortGroupsCount = result.SkippedSortGroups.Count,
                        AppliedFiltersCount = result.AppliedFilters.Count,
                        SkippedFiltersCount = result.SkippedFilters.Count,
                        AppliedHeaderGroupsCount = result.AppliedHeaderGroups.Count,
                        SkippedHeaderGroupsCount = result.SkippedHeaderGroups.Count,
                        CalculatedFieldsCount = result.SkippedCalculatedFields.Count,
                        WarningsCount = result.Warnings.Count
                    },
                AppliedFields =
                    result.AppliedFields.Select(f => new {
                        f.ParameterName,
                        f.ColumnHeaderOverride,
                        f.IsHidden,
                        f.ColumnWidth,
                        DisplayType = f.DisplayType.ToString()
                    }).ToList(),
                SkippedFields = result.SkippedFields.Select(s => new { Reason = s }).ToList(),
                AppliedSortGroups =
                    result.AppliedSortGroups.Select(sg => new {
                        sg.FieldName,
                        SortOrder = sg.SortOrder.ToString(),
                        sg.ShowHeader,
                        sg.ShowFooter,
                        sg.ShowBlankLine
                    }).ToList(),
                SkippedSortGroups = result.SkippedSortGroups.Select(s => new { Reason = s }).ToList(),
                AppliedFilters =
                    result.AppliedFilters.Select(f =>
                        new { f.FieldName, FilterType = f.FilterType.ToString(), f.Value, f.StorageType }).ToList(),
                SkippedFilters = result.SkippedFilters.Select(s => new { Reason = s }).ToList(),
                result.AppliedHeaderGroups,
                SkippedHeaderGroups = result.SkippedHeaderGroups.Select(s => new { Reason = s }).ToList(),
                CalculatedFields =
                    result.SkippedCalculatedFields
                        .Select(f => new { f.FieldName, f.CalculatedType, f.Guidance, f.PercentageOfField }).ToList(),
                result.AppliedViewTemplate,
                result.SkippedViewTemplate,
                result.Warnings
            };

            // Prepend timestamp to filename
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
            var outputPath = createOutputDir.Json($"{timestamp}_{result.ScheduleName}.json").Write(outputData);
            return outputPath;
        } catch (Exception ex) {
            Console.WriteLine($"Failed to write output: {ex.Message}");
            return null;
        }
    }
}

public class ScheduleManagerContext {
    public Document Doc { get; init; }
    public UIDocument UiDoc { get; init; }
    public Storage Storage { get; init; }
    public SettingsManager SettingsManager { get; init; }

    // UI state: what's currently selected and displayed
    public ScheduleListItem SelectedProfile { get; set; }
    public SchedulePreviewData PreviewData { get; set; }
    public Dictionary<string, SchedulePreviewData> PreviewCache { get; } = new();
}

public enum ScheduleTabType {
    Create,
    Batch
}

/// <summary>
///     Interface for items in the unified schedule palette
/// </summary>
public interface ISchedulePaletteItem : IPaletteListItem {
    ScheduleTabType TabType { get; }
    string CategoryName { get; }
    ScheduleListItem GetCreateItem();
    BatchScheduleListItem GetBatchItem();
}

/// <summary>
///     Wrapper that adapts both item types to work in the unified palette
/// </summary>
public class SchedulePaletteItemWrapper : ISchedulePaletteItem {
    private readonly IPaletteListItem _inner;

    public SchedulePaletteItemWrapper(IPaletteListItem inner, ScheduleTabType tabType) {
        this._inner = inner;
        this.TabType = tabType;
    }

    public ScheduleTabType TabType { get; }

    public string CategoryName => this._inner switch {
        ScheduleListItem create => create.CategoryName,
        BatchScheduleListItem => "Batch",
        _ => string.Empty
    };

    public ScheduleListItem GetCreateItem() => this._inner as ScheduleListItem;
    public BatchScheduleListItem GetBatchItem() => this._inner as BatchScheduleListItem;

    // Delegate all IPaletteListItem members to inner
    public string TextPrimary => this._inner.TextPrimary;
    public string TextSecondary => this._inner.TextSecondary;
    public string TextPill => this._inner.TextPill;
    public Func<string> GetTextInfo => this._inner.GetTextInfo;
    public BitmapImage Icon => this._inner.Icon;
    public Color? ItemColor => this._inner.ItemColor;
}