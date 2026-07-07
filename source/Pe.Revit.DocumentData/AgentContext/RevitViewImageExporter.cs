using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.AgentContext;

/// <summary>
///     Exports a graphical view or sheet to a PNG file so agents can visually inspect it.
///     Works without a transaction (safe on read-only documents).
/// </summary>
public static class RevitViewImageExporter {
    public static RevitViewImageData Export(Document document, View view, int pixelSize) {
        var clampedPixelSize = Math.Min(Math.Max(pixelSize, 100), 8000);
        var outputDirectory = Path.Combine(Path.GetTempPath(), "pe-view-captures");
        var baseName = $"view-{view.Id.Value()}-{Guid.NewGuid():N}";
        var producedPath = ExportPng(document, view.Id, outputDirectory, baseName, clampedPixelSize);
        var handle = new RevitAgentContextHandle(
            view is ViewSheet ? RevitAgentContextHandleKind.Sheet : RevitAgentContextHandleKind.View,
            document.GetDocumentKey(),
            view.Id.Value(),
            view.UniqueId,
            view.Name
        );
        return new RevitViewImageData(
            handle,
            producedPath,
            new FileInfo(producedPath) is { Exists: true } file ? file.Length : 0,
            clampedPixelSize
        );
    }

    /// <summary>Exports the given view to a PNG under outputDirectory and returns the actual file path.</summary>
    public static string ExportPng(
        Document document,
        ElementId viewId,
        string outputDirectory,
        string baseName,
        int pixelSize = 2000
    ) {
        Directory.CreateDirectory(outputDirectory);
        var requestedPath = Path.Combine(outputDirectory, baseName + ".png");
        var options = new ImageExportOptions {
            ZoomType = ZoomFitType.FitToPage,
            PixelSize = pixelSize,
            ImageResolution = ImageResolution.DPI_150,
            FitDirection = FitDirectionType.Horizontal,
            ExportRange = ExportRange.SetOfViews,
            HLRandWFViewsFileType = ImageFileType.PNG,
            ShadowViewsFileType = ImageFileType.PNG,
            FilePath = requestedPath
        };
        options.SetViewsAndSheets([viewId]);
        document.ExportImage(options);

        // Revit appends " - <ViewType> - <ViewName>" to the requested name; resolve the real file.
        return Directory.GetFiles(outputDirectory, baseName + "*.png")
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault() ?? requestedPath;
    }
}
