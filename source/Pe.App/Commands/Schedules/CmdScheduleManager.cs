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
using Pe.Revit.SettingsRuntime.Modules;
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
using Pe.App.Pods;
using Pe.Shared.HostContracts.Scripting;

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
            var podSettings = PreparedPodSettingsCatalog.List(".schedule.json", ".batch.json");
            var context = new ScheduleManagerContext {
                Doc = doc,
                UiDoc = uiDoc,
                Storage = storage
            };

            // Collect items for both tabs
            var createItems = podSettings.Where(setting => setting.SourcePath.EndsWith(".schedule.json", StringComparison.OrdinalIgnoreCase)).Select(setting => new ScheduleListItem(setting))
                .OrderByDescending(item => item.LastModified)
                .ToList();
            var batchItems = podSettings.Where(setting => setting.SourcePath.EndsWith(".batch.json", StringComparison.OrdinalIgnoreCase)).Select(setting => new BatchScheduleListItem(setting))
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
                            }
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
                            }
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
        var profile = profileItem.Load();

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
            var batchSettings = batchItem.LoadBatchSettings();

            // Build a summary preview showing all schedules that will be created
            var schedulesList =
                string.Join("\n", batchSettings.ScheduleFiles.Select((path, idx) => $"{idx + 1}. {path}"));
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

        var runOutput = (profileItem.Prepared?.Output() ?? ctx.Storage.Output()).TimestampedSubDir(Guid.NewGuid().ToString("N"));
        ctx.RunOutput = runOutput;

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

        // Load profile fresh for execution
        SharedScheduleProfile scheduleProfile;
        IReadOnlyList<ObservedExternalRevisionData> observedExternalRevisions;
        try {
            scheduleProfile = ctx.SelectedProfile.Load();
            observedExternalRevisions = []; // Schedules consume document fields, not APS definitions.
