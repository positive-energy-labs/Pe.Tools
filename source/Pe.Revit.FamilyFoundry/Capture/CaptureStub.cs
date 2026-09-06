// SHIM: replaced by family/capture merge. The capture line rewrites Capture/** and Snapshots/**; until it
// merges, Capture/FamilyModelCaptureExtensions.cs, Capture/FamilySnapshotCaptureExtensions.cs and the
// ParamDrivenSolids collector are excluded from compile in the csproj and this file stands in.
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Capture;

public static class CaptureStub {
    /// <summary>Empty model, every coverage section `not-read`; the reconciler marks every change Unverifiable.</summary>
    public static FamilyModel CaptureFamilyModel(this Document document) {
        var model = new FamilyModel {
            Family = new FamilyModelHeader {
                Name = document.OwnerFamily?.Name ?? document.Title,
                Template = string.Empty,
                Placement = Enum.TryParse<FamilyModelPlacement>(document.OwnerFamily?.FamilyPlacementType.ToString(), out var p) ? p : FamilyModelPlacement.OneLevelBased
            }
        };
        foreach (var section in FamilyModel.SectionNames) model.Coverage[section] = CoverageState.NotRead;
        return model;
    }

    public static FamilyModel CaptureFamilyModel(this FamilyDocument document) => document.Document.CaptureFamilyModel();

    public static FamilySnapshot CaptureFamilySnapshot(this Document doc) => new FamilyDocument(doc).CaptureFamilySnapshot();

    public static FamilySnapshot CaptureFamilySnapshot(this FamilyDocument famDoc) {
        var snapshot = new FamilySnapshot { FamilyName = famDoc.Document.GetDocumentTitleStem() };
        new SnapshotCapturePipeline()
            .Add(new ParameterSnapshotCollector())
            .Add(new LookupTableSnapshotCollector())
            .Add(new ReferencePlaneSnapshotCollector())
            .ToFamilyDocCollectorFunc()(snapshot, famDoc);
        return snapshot;
    }
}
