using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;
using Pe.Library.Revit.Lib;
using Pe.Library.Revit.Ui;
using Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;
using Pe.Ui.Components;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Input;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdCreateSchedule : IExternalCommand {
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
            var schedulesSubDir = settingsManager.SubDir("schedules", true);

            // Discover all schedule profile JSON files
            var profiles = ScheduleListItem.DiscoverProfiles(schedulesSubDir);
            if (profiles.Count == 0) {
                throw new InvalidOperationException(
                    $"No schedule profiles found in {schedulesSubDir.DirectoryPath}. Create a profile JSON file to continue.");
            }

            // State for tracking current selection
            var context = new ScheduleManagerContext {
                Doc = doc, UiDoc = uiDoc, Storage = storage, SettingsManager = settingsManager
            };

            // Create preview panel
            var previewPanel = new SchedulePreviewPanel();

            // Store window reference to be captured in actions
            EphemeralWindow window = null;

            // Define actions for the palette
            var actions = new List<PaletteAction<ScheduleListItem>> {
                new() {
                    Name = "Create Schedule",
                    Execute = async _ => this.HandleCreateSchedule(context),
                    CanExecute = _ => context.PreviewData?.IsValid == true
                },
                new() {
                    Name = "Place Sample Families",
                    Execute = async _ => this.HandlePlaceSampleFamilies(context),
                    CanExecute = _ => context.SelectedProfile != null
                },
                new() {
                    Name = "Open File",
                    Execute = async _ => this.HandleOpenFile(context),
                    CanExecute = _ => context.SelectedProfile != null
                }
            };

            // Create the palette with sidebar
            window = PaletteFactory.Create("Schedule Manager - Select Profile", profiles, actions,
                new PaletteOptions<ScheduleListItem> {
                    Storage = storage,
                    PersistenceKey = item => item.TextPrimary,
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    FilterKeySelector = item => item.CategoryName,
                    OnSelectionChangedDebounced = item => {
                        this.BuildPreviewData(item, context);
                        if (context.PreviewData != null)
                            previewPanel.UpdatePreview(context.PreviewData);
                    },
                    Sidebar = new PaletteSidebar { Content = previewPanel }
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
        var profile = context.SettingsManager.SubDir("schedules", true)
            .Json<ScheduleSpec>($"{profileItem.TextPrimary}.json")
            .Read();

        // Serialize profile to JSON
        var profileJson = JsonSerializer.Serialize(
            profile,
            new JsonSerializerOptions {
                WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
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
            IsValid = true
        };
    }

    private static SchedulePreviewData CreateValidationErrorPreview(ScheduleListItem profileItem,
        JsonValidationException ex) =>
        new() { ProfileName = profileItem.TextPrimary, IsValid = false, RemainingErrors = ex.ValidationErrors };

    private static SchedulePreviewData
        CreateSanitizationErrorPreview(ScheduleListItem profileItem, JsonSanitizationException ex) {
        var preview = new SchedulePreviewData {
            ProfileName = profileItem.TextPrimary, IsValid = false, RemainingErrors = []
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

    private void HandleCreateSchedule(ScheduleManagerContext ctx) {
        if (ctx.SelectedProfile == null) return;
        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot create schedule - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        var profile = ctx.SettingsManager.SubDir("schedules", true)
            .Json<ScheduleSpec>($"{ctx.SelectedProfile.TextPrimary}.json")
            .Read();

        ScheduleCreationResult result;
        using (var trans = new Transaction(ctx.Doc, "Create Schedule")) {
            _ = trans.Start();
            result = ScheduleHelper.CreateSchedule(ctx.Doc, profile);
            _ = trans.Commit();
        }

        // Write output to storage
        var outputPath = this.WriteCreationOutput(ctx, result);

        // Build comprehensive balloon message
        var balloon = new Ballogger();
        _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
            $"Created schedule '{result.ScheduleName}' from profile '{ctx.SelectedProfile.TextPrimary}'");

        // Report applied fields
        if (result.AppliedFields.Count > 0) {
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Applied {result.AppliedFields.Count} field(s)");
        }

        // Report skipped fields with reasons
        if (result.SkippedFields.Count > 0) {
            _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                $"{result.SkippedFields.Count} field(s) skipped:");
            foreach (var skipped in result.SkippedFields)
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(), $"  • {skipped}");
        }

        // Report calculated fields
        if (result.SkippedCalculatedFields.Count > 0) {
            _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                $"{result.SkippedCalculatedFields.Count} calculated field(s) require manual creation - see output file");
        }

        // Report sort/group issues
        if (result.SkippedSortGroups.Count > 0) {
            _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                $"{result.SkippedSortGroups.Count} sort/group(s) skipped:");
            foreach (var skipped in result.SkippedSortGroups)
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(), $"  • {skipped}");
        }

        // Report filter issues
        if (result.SkippedFilters.Count > 0) {
            _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                $"{result.SkippedFilters.Count} filter(s) skipped:");
            foreach (var skipped in result.SkippedFilters)
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(), $"  • {skipped}");
        }

        // Report header group issues
        if (result.SkippedHeaderGroups.Count > 0) {
            _ = balloon.Add(LogEventLevel.Warning, new StackFrame(),
                $"{result.SkippedHeaderGroups.Count} header group(s) skipped:");
            foreach (var skipped in result.SkippedHeaderGroups)
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(), $"  • {skipped}");
        }

        // Report general warnings
        if (result.Warnings.Count > 0) {
            foreach (var warning in result.Warnings)
                _ = balloon.Add(LogEventLevel.Warning, new StackFrame(), warning);
        }

        balloon.Show();

        // Open the schedule view
        ctx.UiDoc.ActiveView = result.Schedule;

        // Open output file if there are issues or calculated fields
        var hasIssues = result.SkippedCalculatedFields.Count > 0 ||
                        result.SkippedFields.Count > 0 ||
                        result.SkippedSortGroups.Count > 0 ||
                        result.SkippedFilters.Count > 0 ||
                        result.SkippedHeaderGroups.Count > 0 ||
                        result.Warnings.Count > 0;

        if (hasIssues && !string.IsNullOrEmpty(outputPath))
            FileUtils.OpenInDefaultApp(outputPath);
    }

    private void HandlePlaceSampleFamilies(ScheduleManagerContext context) {
        var profile = context.SettingsManager.SubDir("schedules", true)
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

    private void HandleOpenFile(ScheduleManagerContext context) {
        if (context.SelectedProfile == null) return;

        var filePath = context.SelectedProfile.FilePath;
        if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Profile file not found: {filePath}")
                .Show();
            return;
        }

        FileUtils.OpenInDefaultApp(filePath);
    }

    private string WriteCreationOutput(ScheduleManagerContext ctx, ScheduleCreationResult result) {
        try {
            var outputData = new {
                result.ScheduleName,
                result.CategoryName,
                result.IsItemized,
                ProfileName = ctx.SelectedProfile.TextPrimary,
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
                CalculatedFields = result.SkippedCalculatedFields.Select(f => new {
                    f.FieldName, f.CalculatedType, f.Guidance, f.PercentageOfField
                }).ToList(),
                result.Warnings
            };

            var outputPath = ctx.Storage.OutputDir().Json("schedule-creation").Write(outputData);
            return outputPath;
        } catch (Exception ex) {
            Debug.WriteLine($"Failed to write output: {ex.Message}");
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

public class ScheduleSettings {
    [Description(
        "Current profile to use for the command. This determines which schedule profile is used when creating a schedule.")]
    [Required]
    public string CurrentProfile { get; set; } = "Default";
}