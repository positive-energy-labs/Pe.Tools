using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.StorageRuntime;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Generic context for Family Foundry palette operations.
///     Holds document references, storage, settings, and UI state.
/// </summary>
/// <typeparam name="TProfile">The profile type (must inherit from BaseProfile)</typeparam>
public class FoundryContext<TProfile> where TProfile : BaseProfile, new() {
    public required Document Doc { get; init; }
    public required UIDocument UiDoc { get; init; }
    public required ModuleStorage<TProfile> Storage { get; init; }
    public required ModuleSettingsStorage<TProfile> Settings { get; init; }
    public required ModuleDocumentStorage Documents { get; init; }
    public required OnProcessingFinishSettings OnFinishSettings { get; init; }

    // UI state: what's currently selected and displayed
    public ProfileListItem? SelectedProfile { get; set; }
    public PreviewData? PreviewData { get; set; }
}