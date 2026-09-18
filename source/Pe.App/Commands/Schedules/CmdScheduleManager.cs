using System.Windows.Media;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Commands.Schedules.Ui;
using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Revit.DocumentData.Schedules;
using Pe.Revit.Global.Ui;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Revit.Ui.Core;
using Pe.Shared.StorageRuntime;
using Serilog;
using Serilog.Events;
using System.Diagnostics;
using System.IO;
using Color = System.Windows.Media.Color;
using JsonValidationException = Pe.Revit.SettingsRuntime.Json.JsonValidationException;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;
using Pe.App.Host;
using Pe.App.Pods;

namespace Pe.App.Commands.Schedules;

[Transaction(TransactionMode.Manual)]
public class CmdScheduleManager : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) => this.Run(commandData.Application);

    /// <summary> Opens the Schedule Manager palette. Shared by the ribbon command and the switcher. </summary>
    internal Result Run(UIApplication uiapp) {
        var uiDoc = uiapp.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var storage = RuntimeStorageClient.Default.Module(ScheduleManagerSettingsRegistration.ModuleKey);
            // Context for Schedule tabs
            var context = new ScheduleManagerContext {
                Doc = doc,
                UiDoc = uiDoc,
                Storage = storage
            };

            // Collect items for both tabs
            var createItems = PodMembers.List(ScheduleManagerSettingsRegistration.Profiles)
                .Select(entry => new ScheduleListItem(entry.Pod, entry.Member))
                .OrderByDescending(item => item.LastModified)
                .ToList();
            var batchItems = PodMembers.List(ScheduleManagerSettingsRegistration.Batch)
                .Select(entry => new BatchScheduleListItem(entry.Pod, entry.Member))
                .OrderByDescending(item => item.LastModified)
                .ToList();

            // Create preview panel with injected preview building logic
            var previewPanel = new SchedulePreviewPanel((item, ct) => {
                if (item == null) return Task.FromResult<SchedulePreviewData?>(null);

                if (item.TabType == ScheduleTabType.Create) {
                    var createItem = item.GetCreateItem();
                    if (createItem == null || ct.IsCancellationRequested) return Task.FromResult<SchedulePreviewData?>(null);

                    var previewData = this.TryLoadPreviewData(createItem);
                    if (ct.IsCancellationRequested) return Task.FromResult<SchedulePreviewData?>(null);

                    // Update shared UI context only after background work completes.
                    context.SelectedProfile = createItem;
                    context.PreviewData = previewData;
                    return Task.FromResult<SchedulePreviewData?>(previewData);
                }

                if (item.TabType == ScheduleTabType.Batch) {
                    var batchItem = item.GetBatchItem();
                    if (batchItem == null || ct.IsCancellationRequested) return Task.FromResult<SchedulePreviewData?>(null);

                    var previewData = this.BuildBatchPreview(batchItem);
                    if (ct.IsCancellationRequested) return Task.FromResult<SchedulePreviewData?>(null);

                    context.PreviewData = previewData;
                    return Task.FromResult<SchedulePreviewData?>(previewData);
                }

                return Task.FromResult<SchedulePreviewData?>(null);
            });

            // Create the palette with tabs - each tab defines its own items and actions
            var window = PaletteFactory.Create("Schedule Manager",
                new PaletteOptions<ISchedulePaletteItem> {
                    Persistence = (Storage: storage, PersistenceKey: item => item.TextPrimary),
                    DefaultTabIndex = 0,
                    SidebarPanel = previewPanel,
                    Tabs = [
                        new TabDefinition<ISchedulePaletteItem>(
                            "Create",
                            () => createItems.Select(i =>
                                new SchedulePaletteItemWrapper(i, ScheduleTabType.Create)),
                            new PaletteAction<ISchedulePaletteItem> {
                                Name = "Create Schedule",
                                Execute = item => this.HandleCreate(context, item),
                                CanExecute = item => context.PreviewData?.IsValid == true
                            },
                            new PaletteAction<ISchedulePaletteItem> {
                                Name = "Open JSON File",
                                Execute = item => this.HandleOpenFile(item),
                                CanExecute = item => item.GetCreateItem() != null
                            },
                            new PaletteAction<ISchedulePaletteItem> {
                                Name = "Place Matching Families",
                                Execute = item => this.HandlePlaceSampleFamilies(context, item),
                                CanExecute = item =>
                                    item.TabType == ScheduleTabType.Create && context.SelectedProfile != null
                            },
                            OpenInPods()
                        ) { FilterKeySelector = i => i.CategoryName },
                        new TabDefinition<ISchedulePaletteItem>(
                            "Batch",
                            () => batchItems.Select(i =>
                                new SchedulePaletteItemWrapper(i, ScheduleTabType.Batch)),
                            new PaletteAction<ISchedulePaletteItem> {
                                Name = "Open Profile File",
                                Execute = item => this.HandleOpenFile(item),
                                CanExecute = item => item.GetBatchItem() != null
                            },
                            new PaletteAction<ISchedulePaletteItem> {
                                Name = "Create Schedules",
                                Execute = item => this.HandleCreate(context, item),
                                CanExecute = item => context.PreviewData?.IsValid == true
                            },
                            OpenInPods()
                        ) { FilterKeySelector = i => string.Empty }
                    ]
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

        context.SelectedProfile = profileItem;
        context.PreviewData = this.TryLoadPreviewData(profileItem);
    }

    private SchedulePreviewData TryLoadPreviewData(ScheduleListItem profileItem) {
        try {
            return this.LoadValidPreviewData(profileItem);
        } catch (JsonValidationException ex) {
            return CreateValidationErrorPreview(profileItem, ex);
        } catch (Exception ex) {
            return CreateGenericErrorPreview(profileItem, ex);
        }
    }

    private SchedulePreviewData LoadValidPreviewData(ScheduleListItem profileItem) {
        var profile = profileItem.Member.Load<SharedScheduleProfile>(profileItem.Pod).Spec;

        // Serialize profile to JSON
        var profileJson = JsonConvert.SerializeObject(
            profile,
            RevitJsonFormatting.CreateRevitIndentedSettings()
        );

        var categoryLabel = string.IsNullOrWhiteSpace(profile.CategoryName)
            ? string.Empty
            : profile.CategoryName;

        return new SchedulePreviewData {
            ProfileName = profileItem.TextPrimary,
            CategoryName = categoryLabel,
            IsItemized = profile.IsItemized,
            Fields = profile.Fields ?? [],
            SortGroup = profile.SortGroup ?? [],
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

    private static SchedulePreviewData CreateGenericErrorPreview(ScheduleListItem profileItem, Exception ex) =>
        new() {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            RemainingErrors = [$"{ex.GetType().Name}: {ex.Message}"]
        };

    private SchedulePreviewData BuildBatchPreview(BatchScheduleListItem batchItem) {
        try {
            var schedules = batchItem.Schedules();

            // Build a summary preview showing all schedules that will be created
            var schedulesList =
                string.Join("\n", schedules.Select((member, idx) => $"{idx + 1}. {member.Path}"));
            var profileJson = $"Batch will create {schedules.Count} schedule(s):\n\n{schedulesList}";

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

    private void HandleCreate(ScheduleManagerContext ctx, ISchedulePaletteItem item) {
        switch (item.TabType) {
        case ScheduleTabType.Create:
            this.HandleCreateSingle(ctx, item);
            break;
        case ScheduleTabType.Batch:
            this.HandleCreateBatch(ctx, item);
            break;
        default:
            throw new ArgumentException("Invalid schedule tab type");
        }
    }

    private void HandleCreateSingle(ScheduleManagerContext ctx, ISchedulePaletteItem item) {
        var profileItem = item.GetCreateItem();
        if (profileItem == null) return;


        // Preview selection already performs schema sync + validation before this action is enabled.
        var hasCurrentValidPreview = ctx.PreviewData?.IsValid == true &&
                                     string.Equals(
                                         ctx.SelectedProfile?.FilePath,
                                         profileItem.FilePath,
                                         StringComparison.OrdinalIgnoreCase);
        if (!hasCurrentValidPreview)
            this.BuildPreviewData(profileItem, ctx);

        if (ctx.PreviewData?.IsValid != true || ctx.SelectedProfile == null) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot create schedule - profile has validation errors")
                .Show();
            return;
        }

        // Load the member fresh for execution; the apply edge refuses it if the bytes change underneath.
        SharedScheduleProfile scheduleProfile;
        ScheduleCreationResult result;
        string receiptPath;
        try {
            var (spec, composed, source) = ctx.SelectedProfile.Member.Load<SharedScheduleProfile>(ctx.SelectedProfile.Pod);
            scheduleProfile = spec;
            var applied = ScheduleBridgeOps.ApplySpec(ctx.Doc, spec, composed, source);
            result = applied.Result;
            receiptPath = applied.Data.ReceiptPath;
        } catch (Exception ex) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), ex, true)
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
                        !string.IsNullOrEmpty(result.FilterBySheetSkipped) ||
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
            !string.IsNullOrEmpty(scheduleProfile.ViewTemplateName) && result.AppliedViewTemplate != null;
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
            .AddIf(result.FilterBySheetApplied, LogEventLevel.Information, null,
                "Filter by sheet: Enabled")
            .AddIf(!string.IsNullOrEmpty(result.FilterBySheetSkipped), LogEventLevel.Warning, null,
                $"Filter by sheet skipped: {result.FilterBySheetSkipped}")
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
            .AddIf(!string.IsNullOrEmpty(scheduleProfile.ViewTemplateName) && result.AppliedViewTemplate == null,
                LogEventLevel.Warning, null,
                $"View template skipped: {result.SkippedViewTemplate}")
            .AddIf(hasWarnings, LogEventLevel.Warning, null, "Warnings:")
            .AddIf(hasWarnings, LogEventLevel.Warning, null,
                string.Join("\n", result.Warnings.Select(w => $"  • {w}")))
            .Show(() => FileUtils.OpenInDefaultApp(receiptPath), "Open Receipt");


        // Open the schedule view
        // if (scheduleProfile.OnFinish.OpenScheduleOnFinish) {
        //     ctx.UiDoc.ActiveView = result.Schedule;
        // }
    }

    private void HandlePlaceSampleFamilies(ScheduleManagerContext context, ISchedulePaletteItem item) {
        var profileItem = item.GetCreateItem();
        if (profileItem == null) return;

        // Update context with selected profile
        this.BuildPreviewData(profileItem, context);

        if (context.SelectedProfile == null || context.PreviewData?.IsValid != true) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(),
                    "Cannot place sample families - profile has validation errors")
                .Show();
            return;
        }

        var profile = context.SelectedProfile.Member.Load<SharedScheduleProfile>(context.SelectedProfile.Pod).Spec;

        // Get families of the schedule's category
        var category = CategoryNamesValueDomain.TryFindCategoryByName(context.Doc, profile.CategoryName);
        var categoryLabel = profile.CategoryName;

        if (category == null) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Category '{categoryLabel}' not found")
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
                    $"No {categoryLabel} families found in the project")
                .Show();
            return;
        }

        // Use Revit's native schedule filtering to find families that match the profile's filters
        var matchingFamilyNames = context.Doc.GetFamiliesMatchingScheduleProfileFilters(
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

    /// <summary>The same `/pods?pod=&amp;path=` deep link both Family Foundry palettes carry (w4-revit claim 15).</summary>
    private static PaletteAction<ISchedulePaletteItem> OpenInPods() => new() {
        Name = "Open in Pods",
        Execute = item => {
            var address = item.GetCreateItem() is { } create ? new PodMemberAddress(create.Pod.Manifest.Id, create.Member.Path)
                : item.GetBatchItem() is { } batch ? new PodMemberAddress(batch.Pod.Manifest.Id, batch.Member.Path)
                : null;
            if (address is not null) _ = PeToolsBrowser.TryLaunch(address);
        },
        CanExecute = item => item.GetCreateItem() != null || item.GetBatchItem() != null
    };

    private void HandleOpenFile(ISchedulePaletteItem item) {
        var filePath = item.GetCreateItem()?.FilePath ?? item.GetBatchItem()?.FilePath;
        if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Profile file not found: {filePath}")
                .Show();
            return;
        }

        FileUtils.OpenInDefaultApp(filePath);
    }

    private void HandleCreateBatch(ScheduleManagerContext context, ISchedulePaletteItem item) {
        var batchItem = item.GetBatchItem();
        if (batchItem == null) return;

        try {
            var results = new List<(string profileName, bool success, string errorMessage)>();
            var createdSchedules = new List<string>();
            var receipts = new List<string>();

            foreach (var member in batchItem.Schedules()) {
                try {
                    var (spec, composed, source) = member.Load<SharedScheduleProfile>(batchItem.Pod);
                    var applied = ScheduleBridgeOps.ApplySpec(context.Doc, spec, composed, source);
                    results.Add((member.Path, true, string.Empty));
                    createdSchedules.Add(applied.Result.ScheduleName);
                    receipts.Add(applied.Data.ReceiptPath);
                } catch (Exception ex) {
                    results.Add((member.Path, false, ex.Message));
                }
            }

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

            var runs = receipts.Count > 0 ? Path.GetDirectoryName(Path.GetDirectoryName(receipts[0])!)! : batchItem.Pod.Folder;
            balloon.Show(() => FileUtils.OpenInDefaultApp(runs), "Open Runs Folder");
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
        }
    }
}

public class ScheduleManagerContext {
    public required Document Doc { get; init; }
    public required UIDocument UiDoc { get; init; }
    public required ModuleStorage Storage { get; init; }

    // UI state: what's currently selected and displayed
    public ScheduleListItem? SelectedProfile { get; set; }
    public SchedulePreviewData? PreviewData { get; set; }
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
    ScheduleListItem? GetCreateItem();
    BatchScheduleListItem? GetBatchItem();
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

    public ScheduleListItem? GetCreateItem() => this._inner as ScheduleListItem;
    public BatchScheduleListItem? GetBatchItem() => this._inner as BatchScheduleListItem;

    // Delegate all IPaletteListItem members to inner
    public string TextPrimary => this._inner.TextPrimary;
    public string TextSecondary => this._inner.TextSecondary;
    public string? TextPill => this._inner.TextPill;
    public Func<string> GetTextInfo => this._inner.GetTextInfo;
    public ImageSource? Icon => this._inner.Icon;
    public Color? ItemColor => this._inner.ItemColor;
}
