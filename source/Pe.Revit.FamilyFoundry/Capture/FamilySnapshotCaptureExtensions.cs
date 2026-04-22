using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Revit.FamilyFoundry.Capture;

public static class FamilySnapshotCaptureExtensions {
    public static FamilySnapshot CaptureFamilySnapshot(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));
        if (!doc.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        return new FamilyDocument(doc).CaptureFamilySnapshot();
    }

    public static FamilySnapshot CaptureFamilySnapshot(this FamilyDocument famDoc) {
        var snapshot = new FamilySnapshot { FamilyName = famDoc.Document.GetDocumentTitleStem() };
        var collectFromFamilyDocument = CreateDefaultSnapshotCapturePipeline().ToFamilyDocCollectorFunc();
        collectFromFamilyDocument(snapshot, famDoc);
        return snapshot;
    }

    private static SnapshotCapturePipeline CreateDefaultSnapshotCapturePipeline() =>
        new SnapshotCapturePipeline()
            .Add(new ParameterSnapshotCollector())
            .Add(new LookupTableSnapshotCollector())
            .Add(new ReferencePlaneSnapshotCollector())
            .Add(new ParamDrivenSolidsSnapshotCollector());
}
