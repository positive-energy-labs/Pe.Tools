using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Generic context for Family Foundry palette operations.
///     Holds document references, storage, settings, and UI state.
/// </summary>
/// <typeparam name="TProfile">The profile type (must inherit from BaseProfileSettings)</typeparam>
public class FoundryContext<TProfile> where TProfile : BaseProfileSettings, new() {
    public Document Doc { get; init; }
    public UIDocument UiDoc { get; init; }
    public ModuleStorage<TProfile> Storage { get; init; }
    public ModuleSettingsStorage<TProfile> Settings { get; init; }
    public ModuleDocumentStorage Documents { get; init; }
    public OnProcessingFinishSettings OnFinishSettings { get; init; }

    // UI state: what's currently selected and displayed
    public ProfileListItem SelectedProfile { get; set; }
    public PreviewData PreviewData { get; set; }
}
