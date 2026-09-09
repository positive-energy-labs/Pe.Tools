using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>What the foundry palette knows: the documents, the storage module, and the selected file parsed.</summary>
public sealed class FoundryContext {
    public required Document Doc { get; init; }
    public required UIDocument UiDoc { get; init; }
    public required ModuleStorage Storage { get; init; }
    public required ModuleDocumentStorage Documents { get; init; }
    public LoadAndSaveOptions OnFinishSettings { get; init; } = new() { OpenOutputFilesOnCommandFinish = false };

    public ProfileListItem? SelectedProfile { get; set; }
    public PreviewData? PreviewData { get; set; }

    /// <summary>The selected `*.family.json`, parsed and expanded; null for a patch or an invalid file.</summary>
    public FamilyModel? Model => this.PreviewData?.Model;

    /// <summary>The selected `*.patch.json`; null for a family.json or an invalid file.</summary>
    public FamilyPatch? Patch => this.PreviewData?.Patch;
}
