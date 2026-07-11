using System.Windows.Media;
using Pe.Revit.Loader.Documents;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Per-document UI color (pyRevit tab colors), cached in the tracked document's State bag so
///     it lives exactly as long as the document — no close-event cleanup wiring. Falls back to a
///     consistent DimGray when UI read fails, which makes detection failures obvious.
/// </summary>
public static class DocumentColors {
    private static readonly WpfColor FallbackColor = Colors.DimGray;

    public static WpfColor Get(Autodesk.Revit.DB.Document document) {
        if (document == null) return Colors.Gray;

        var tracked = DocumentTrackerAccessor.Current?.Find(document);
        if (tracked == null)
            return Compute(document);

        return tracked.State(_ => new ColorState(Compute(document))).Value;
    }

    private static WpfColor Compute(Autodesk.Revit.DB.Document document) =>
        RevitTabColorReader.GetDocumentColorFromUI(document) ?? FallbackColor;

    private sealed record ColorState(WpfColor Value);
}
