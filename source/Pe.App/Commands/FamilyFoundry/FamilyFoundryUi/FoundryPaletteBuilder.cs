using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.Global;
using Pe.Global.Services.Storage;
using Pe.Global.Utils.Files;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

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
    ///     Builds and returns the palette window.
    /// </summary>
    public EphemeralWindow Build() {
        if (this._queueBuilder == null)
            throw new InvalidOperationException("Queue builder must be set via WithQueueBuilder()");

        // Setup storage and settings
        var storage = new Storage(this._commandName);
        var settingsManager = storage.SettingsDir();
        var settings = settingsManager.Json<BaseSettings<TProfile>>().Read();
        var profilesSubDir = settingsManager.SubDir("profiles", true);

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

        // Create preview panel
        var previewPanel = new ProfilePreviewPanel();

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
            profiles,
            paletteActions,
            new PaletteOptions<ProfileListItem> {
                Storage = storage,
                PersistenceKey = item => item.TextPrimary,
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                FilterKeySelector = item => string.IsNullOrEmpty(item.ExtendsValue) ? "Base" : "Extended",
                OnSelectionChangedDebounced = item => {
                    this.BuildPreviewData(item, context);
                    if (context.PreviewData != null)
                        previewPanel.UpdatePreview(context.PreviewData);
                },
                Sidebar = new PaletteSidebar { Content = previewPanel }
            });

        return window;
    }

    private void BuildPreviewData(ProfileListItem profileItem, FoundryContext<TProfile> context) {
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

    private PreviewData TryLoadPreviewData(ProfileListItem profileItem, FoundryContext<TProfile> context) {
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

    private PreviewData LoadValidPreviewData(ProfileListItem profileItem, FoundryContext<TProfile> context) {
        // Load the profile
        var profile = context.SettingsManager.SubDir("profiles", true)
            .Json<TProfile>($"{profileItem.TextPrimary}.json")
            .Read();

        // Get raw APS parameter models (no Revit API dependencies, safe to store)
        var apsParamModels = profile.GetFilteredApsParamModels();

        // Build queue structure for preview (using temp file just for structure, not storing definitions)
        using var previewTempFile = new TempSharedParamFile(context.Doc);
        var previewApsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
            apsParamModels, previewTempFile);

        var queue = this._queueBuilder(profile, previewApsParamData);
        var operationMetadata = queue.GetExecutableMetadata();
        var families = profile.GetFamilies(context.Doc);

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

        // Serialize profile to JSON
        var profileJson = JsonSerializer.Serialize(
            profile,
            new JsonSerializerOptions {
                WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            });

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
            RemainingErrors = new List<string> { $"{ex.GetType().Name}: {ex.Message}" },
            AppliedFixes = new List<string>()
        };
}

/// <summary>
///     Represents an action in the Foundry palette.
/// </summary>
internal class FoundryAction<TProfile> where TProfile : BaseProfileSettings {
    public string Name { get; init; }
    public Action<FoundryContext<TProfile>> Handler { get; init; }
    public Func<FoundryContext<TProfile>, bool> CanExecute { get; init; }
}