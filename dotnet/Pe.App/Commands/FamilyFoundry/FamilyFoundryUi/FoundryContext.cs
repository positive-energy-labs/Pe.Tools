using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>What the foundry palette knows: the storage module (palette state only) and the selected pod member.</summary>
public sealed class FoundryContext {
    public required Document Doc { get; init; }
    public required UIDocument UiDoc { get; init; }
    public required ModuleStorage Storage { get; init; }
    public LoadAndSaveOptions OnFinishSettings { get; init; } = new() { OpenOutputFilesOnCommandFinish = false };

    public ProfileListItem? SelectedProfile { get; set; }
    public PreviewData? PreviewData { get; set; }

    /// <summary>The selected family model member, parsed and composed; null for a patch or an invalid member.</summary>
    public FamilyModel? Model => this.PreviewData?.Model;

    /// <summary>The selected family patch member; null for a model or an invalid member.</summary>
    public FamilyPatch? Patch => this.PreviewData?.Patch;
}
