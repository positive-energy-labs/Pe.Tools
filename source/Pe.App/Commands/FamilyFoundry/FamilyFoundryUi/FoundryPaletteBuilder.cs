using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.Global;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Utils.Files;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Fluent builder for creating Family Foundry palette UIs.
///     Handles all infrastructure (storage, profile discovery, preview, palette wiring)
///     while keeping command-specific logic (queue building, actions) in command files.
/// </summary>
/// <typeparam name="TProfile">The profile type (must inherit from BaseProfileSettings)</typeparam>
public class FoundryPaletteBuilder<TProfile> where TProfile : BaseProfileSettings, new() {
    private readonly List<FoundryAction<TProfile>> _actions = [];
    private readonly string _commandName;
    private readonly Document _doc;
    private readonly UIDocument _uiDoc;
    private Action<FoundryContext<TProfile>, List<string>> _postProcess;
    private Func<TProfile, List<SharedParameterDefinition>, OperationQueue> _queueBuilder;
    private bool _enableToonIncludes;

    public FoundryPaletteBuilder(string commandName, Document doc, UIDocument uiDoc) {
        this._commandName = commandName;
        this._doc = doc;
        this._uiDoc = uiDoc;
    }

    /// <summary>
    ///     Adds an action to the palette.
    /// </summary>
    /// <param name="name">Action name displayed in the palette</param>
    /// <param name="handler">Action handler that receives the context</param>
    /// <param name="canExecute">Optional predicate to enable/disable the action</param>
    public FoundryPaletteBuilder<TProfile> WithAction(
        string name,
        Action<FoundryContext<TProfile>> handler,
        Func<FoundryContext<TProfile>, bool> canExecute = null
    ) {
        this._actions.Add(new FoundryAction<TProfile> { Name = name, Handler = handler, CanExecute = canExecute });
        return this;
    }

    /// <summary>
    ///     Sets the queue builder function.
    ///     This function receives the profile and APS parameters and returns an OperationQueue.
    /// </summary>
    public FoundryPaletteBuilder<TProfile> WithQueueBuilder(
        Func<TProfile, List<SharedParameterDefinition>, OperationQueue> queueBuilder
    ) {
        this._queueBuilder = queueBuilder;
        return this;
    }

    /// <summary>
    ///     Sets the post-processing callback.
    ///     Called after family processing completes with the context and list of processed family names.
    /// </summary>
    public FoundryPaletteBuilder<TProfile> WithPostProcess(
        Action<FoundryContext<TProfile>, List<string>> postProcess
    ) {
        this._postProcess = postProcess;
        return this;
    }

    /// <summary>
    ///     Enables TOON fragment includes while loading profile JSON in this palette flow.
    /// </summary>
    public FoundryPaletteBuilder<TProfile> WithToonIncludes(bool enabled = true) {
        this._enableToonIncludes = enabled;
        return this;
    }

    /// <summary>
    ///     Builds and returns the palette window.
    /// </summary>
    public EphemeralWindow Build() {
        if (this._queueBuilder == null)
            throw new InvalidOperationException("Queue builder must be set via WithQueueBuilder()");

        // Setup storage and settings
        var storage = new Storage(this._commandName);
        var settingsManager = storage.SettingsDir();
        var settings = settingsManager.Json<BaseSettings<TProfile>>().Read();
        var profilesSubDir = settingsManager.SubDir("profiles");

        // Discover profiles
        var profiles = ProfileListItem.DiscoverProfiles(profilesSubDir);
        if (profiles.Count == 0) {
            throw new InvalidOperationException(
                $"No profiles found in {profilesSubDir.DirectoryPath}. Create a profile JSON file to continue.");
        }

        // Create context
        var context = new FoundryContext<TProfile> {
            Doc = this._doc,
            UiDoc = this._uiDoc,
            Storage = storage,
            SettingsManager = settingsManager,
            OnFinishSettings = settings.OnProcessingFinish
        };

        // Create preview panel with injected preview building logic
        var previewPanel = new ProfilePreviewPanel(async (item, ct) => {
            var data = await this.BuildPreviewDataAsync(item, context, ct);
            context.SelectedProfile = item;
            context.PreviewData = data;
            return data;
        });

        // Store window reference to be captured in actions
        EphemeralWindow window = null;

        // Convert FoundryActions to PaletteActions
        var paletteActions = this._actions.Select(a => new PaletteAction<ProfileListItem> {
            Name = a.Name,
            Execute = async _ => a.Handler(context),
            CanExecute = _ => a.CanExecute?.Invoke(context) ?? true
        }).ToList();

        // Create the palette with sidebar
        window = PaletteFactory.Create(
            $"{this._commandName} - Select Profile",
            new PaletteOptions<ProfileListItem> {
                Persistence = (storage, item => item.TextPrimary),
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                SidebarPanel = previewPanel,
                Tabs = [
                    new TabDefinition<ProfileListItem>(
                        "All",
                        () => profiles,
                        paletteActions
                    ) {
                        FilterKeySelector = _ => "Profiles"
                    }
                ]
            });

        return window;
    }

    private async Task<PreviewData?> BuildPreviewDataAsync(
        ProfileListItem profileItem,
        FoundryContext<TProfile> context,
        CancellationToken ct
    ) {
        if (ct.IsCancellationRequested) return null;
        if (profileItem == null) return null;

        return await this.TryLoadPreviewDataAsync(profileItem, context, ct);
    }

    private async Task<PreviewData?> TryLoadPreviewDataAsync(
        ProfileListItem profileItem,
        FoundryContext<TProfile> context,
        CancellationToken ct
    ) {
        try {
            return await this.LoadValidPreviewDataAsync(profileItem, context, ct);
        } catch (JsonValidationException ex) {
            return CreateValidationErrorPreview(profileItem, ex);
        } catch (JsonSanitizationException ex) {
            return CreateSanitizationErrorPreview(profileItem, ex);
        } catch (Exception ex) {
            return CreateGenericErrorPreview(profileItem, ex);
        }
    }

    private async Task<PreviewData?> LoadValidPreviewDataAsync(
        ProfileListItem profileItem,
        FoundryContext<TProfile> context,
        CancellationToken ct
    ) {
        if (ct.IsCancellationRequested) return null;

        // Load the profile
        using var toonScope = JsonArrayComposer.EnableToonIncludesScope(this._enableToonIncludes);
        var profile = context.SettingsManager.SubDir("profiles")
            .Json<TProfile>($"{profileItem.TextPrimary}.json")
            .Read();

        if (ct.IsCancellationRequested) return null;

        // Get raw APS parameter models (no Revit API dependencies, safe to store)
        var apsParamModels = profile.GetFilteredApsParamModels();

        if (ct.IsCancellationRequested) return null;

        // Build queue structure for preview (using temp file just for structure, not storing definitions)
        var previewApsParamData = await PaletteThreading.RunRevitAsync(() => {
            using var previewTempFile = new TempSharedParamFile(context.Doc);
            return BaseProfileSettings.ConvertToSharedParameterDefinitions(apsParamModels, previewTempFile);
        }, ct);

        if (ct.IsCancellationRequested || previewApsParamData == null) return null;

        var queue = this._queueBuilder(profile, previewApsParamData);
        var operationMetadata = queue.GetExecutableMetadata();

        var families = await PaletteThreading.RunRevitAsync(() => profile.GetFamilies(context.Doc), ct);

        if (ct.IsCancellationRequested || families == null) return null;

        // Extract APS parameter info
        var apsParameters = apsParamModels.Select(p => new ParameterInfo(
            p.Name,
            p.DownloadOptions.IsInstance,
            GetDataTypeName(p.DownloadOptions.GetSpecTypeId())
        )).ToList();

        // Extract AddAndSet parameter info - this is profile-specific, so we skip it for now
        // Commands can override this if needed
        var addAndSetParameters = new List<ParameterInfo>();

        // Extract family info with categories
        var familyInfos = families.Select(f => new FamilyInfo(
            f.Name,
            f.FamilyCategory?.Name ?? "Unknown"
        )).ToList();

        if (ct.IsCancellationRequested) return null;

        // Serialize profile to JSON
        var profileJson = JsonSerializer.Serialize(
            profile,
            new JsonSerializerOptions {
                WriteIndented = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            });

        if (ct.IsCancellationRequested) return null;

        // Check operation enabled status from queue
        var operationInfos = new List<OperationInfo>();
        foreach (var op in queue.Operations) {
            var metadata = operationMetadata.FirstOrDefault(m => m.Name == op.Name);
            if (metadata != default) {
                var isEnabled = op.Settings?.Enabled ?? true;
                operationInfos.Add(new OperationInfo(
                    metadata.Name,
                    metadata.Description,
                    metadata.Type,
                    metadata.IsMerged,
                    isEnabled
                ));
            }
        }

        if (ct.IsCancellationRequested) return null;

        return new PreviewData {
            ProfileName = profileItem.TextPrimary,
            FilePath = profileItem.FilePath,
            CreatedDate = profileItem._fileInfo.CreationTime,
            ModifiedDate = profileItem._fileInfo.LastWriteTime,
            LineCount = profileItem.LineCount,
            Operations = operationInfos,
            ApsParameters = apsParameters,
            AddAndSetParameters = addAndSetParameters,
            Families = familyInfos,
            ProfileJson = profileJson,
            IsValid = true
        };
    }

    private static string GetDataTypeName(ForgeTypeId dataType) {
        if (dataType == null || string.IsNullOrEmpty(dataType.TypeId))
            return "Text";

        var typeId = dataType.TypeId;
        var lastDash = typeId.LastIndexOf('-');
        return lastDash >= 0 ? typeId[(lastDash + 1)..] : typeId;
    }

    private static PreviewData CreateValidationErrorPreview(ProfileListItem profileItem, JsonValidationException ex) =>
        new() {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            RemainingErrors = ex.ValidationErrors,
            AppliedFixes = new List<string>()
        };

    private static PreviewData
        CreateSanitizationErrorPreview(ProfileListItem profileItem, JsonSanitizationException ex) {
        var preview = new PreviewData {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            AppliedFixes = ex.AppliedMigrations,
            RemainingErrors = new List<string>()
        };

        if (ex.AddedProperties.Any())
            preview.RemainingErrors.Add($"Added properties: {string.Join(", ", ex.AddedProperties)}");

        if (ex.RemovedProperties.Any())
            preview.RemainingErrors.Add($"Removed properties: {string.Join(", ", ex.RemovedProperties)}");

        return preview;
    }

    private static PreviewData CreateGenericErrorPreview(ProfileListItem profileItem, Exception ex) =>
        new() {
            ProfileName = profileItem.TextPrimary,
            IsValid = false,
            RemainingErrors = BuildGenericErrorMessages(ex),
            AppliedFixes = new List<string>()
        };

    private static List<string> BuildGenericErrorMessages(Exception ex) {
        if (ex is InvalidOperationException invalidOp &&
            invalidOp.Message.StartsWith("Duplicate parameter names in AddAndSetParams.Parameters:",
                StringComparison.Ordinal))
            return new List<string> {
                invalidOp.Message,
                "Fix: keep exactly one entry per parameter name under AddAndSetParams.Parameters.",
                "Tip: if you define _FOUNDRY LAST PROCESSED AT in the profile, remove duplicate definitions."
            };

        if (ex is InvalidOperationException invalidOpSplitModel &&
            invalidOpSplitModel.Message.Contains("missing value source", StringComparison.OrdinalIgnoreCase))
            return new List<string> {
                invalidOpSplitModel.Message,
                "Fix: for each AddAndSetParams.Parameters item, choose one source:",
                " - ValueOrFormula for global value/formula, OR",
                " - a matching AddAndSetParams.PerTypeValuesTable row where Parameter == Name."
            };

        if (ex is InvalidOperationException invalidOpConflict &&
            invalidOpConflict.Message.Contains("cannot define both ValueOrFormula and PerTypeValuesTable values",
                StringComparison.OrdinalIgnoreCase))
            return new List<string> {
                invalidOpConflict.Message,
                "Fix: remove one source so each parameter uses only one value source.",
                "Use ValueOrFormula for global assignment, or PerTypeValuesTable for per-type assignment."
            };

        if (ex is InvalidOperationException invalidOpUnknownTableRow &&
            invalidOpUnknownTableRow.Message.Contains("PerTypeValuesTable contains row(s) for unknown parameter(s)",
                StringComparison.OrdinalIgnoreCase))
            return new List<string> {
                invalidOpUnknownTableRow.Message,
                "Fix: every PerTypeValuesTable row must reference an existing parameter name.",
                "Set row.Parameter to exactly match a Name in AddAndSetParams.Parameters."
            };

        if (ex is ArgumentException arg &&
            arg.Message.Contains("same key has already been added", StringComparison.OrdinalIgnoreCase))
            return new List<string> {
                $"{arg.GetType().Name}: {arg.Message}",
                "Likely cause: duplicate keys in profile collections (commonly AddAndSetParams parameter names).",
                "Fix: ensure parameter names are unique per profile."
            };

        return new List<string> { $"{ex.GetType().Name}: {ex.Message}" };
    }
}

/// <summary>
///     Represents an action in the Foundry palette.
/// </summary>
internal class FoundryAction<TProfile> where TProfile : BaseProfileSettings {
    public string Name { get; init; }
    public Action<FoundryContext<TProfile>> Handler { get; init; }
    public Func<FoundryContext<TProfile>, bool> CanExecute { get; init; }
}