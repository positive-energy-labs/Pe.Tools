using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.StorageRuntime.Revit;
using Pe.StorageRuntime.Revit.Modules;

namespace Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Generic context for Family Foundry palette operations.
///     Holds document references, storage, settings, and UI state.
/// </summary>
/// <typeparam name="TProfile">The profile type (must inherit from BaseProfileSettings)</typeparam>
public class FoundryContext<TProfile> where TProfile : BaseProfileSettings {
    public Document Doc { get; init; }
    public UIDocument UiDoc { get; init; }
    public StorageClient Storage { get; init; }
    public SharedModuleSettingsStorage SharedStorage { get; init; }
    public OnProcessingFinishSettings OnFinishSettings { get; init; }

    // UI state: what's currently selected and displayed
    public ProfileListItem SelectedProfile { get; set; }
    public PreviewData PreviewData { get; set; }
}
