using System.IO;
using System.Windows.Media.Imaging;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.AgentContext;

/// <summary>
///     Exports a graphical view or sheet to a PNG file so agents can visually inspect it.
///     Captures views exactly as configured — templates, VG overrides, and temporary
///     hide/isolate all apply. Never creates or permanently mutates views.
///     Whole-view capture needs no transaction (safe on read-only documents); focus capture
///     sets a temporary crop box (clearing any scope box) then restores it (editable doc only).
/// </summary>
public static class RevitViewImageExporter {
    public static RevitViewImageData Export(Document document, View view, int pixelSize) {
        var producedPath = ExportToTemp(document, view, pixelSize, out var clamped);
        return BuildResult(document, view, producedPath, clamped, TryModelRect(view), null);
    }

    /// <summary>Focus capture: temporary crop box around <paramref name="modelBox" />, rolled back after export.</summary>
    public static RevitViewImageData ExportFocused(
        Document document,
        View view,
        BoundingBoxXYZ modelBox,
        double marginPercent,
        int pixelSize
    ) {
        if (document.IsReadOnly)
            throw new InvalidOperationException("Focus capture needs an editable document (it sets a temporary crop box).");

        // set → export → restore with committed transactions, NOT a rolled-back TransactionGroup:
        // ExportImage inside an open group renders the pre-group state (verified live on Chadds).
        // A scope box assigned to the view LOCKS its crop to the scope-box extent — a CropBox
        // write is silently ignored (verified: crop snaps back). So clear the scope box for the
        // duration, then restore it; a scope box drives graphics-free geometry, so clearing it
        // does not change what the export shows other than the crop we are deliberately setting.
        var scopeParam = view.get_Parameter(BuiltInParameter.VIEWER_VOLUME_OF_INTEREST_CROP);
        var originalScopeId = scopeParam is { IsReadOnly: false } ? scopeParam.AsElementId() : ElementId.InvalidElementId;
        var originalCrop = view.CropBox;
        var originalActive = view.CropBoxActive;
        var originalVisible = view.CropBoxVisible;
        RunCropTransaction(document, "PE temporary crop", () => {
            if (originalScopeId != ElementId.InvalidElementId) scopeParam!.Set(ElementId.InvalidElementId);
            ApplyCrop(view, modelBox, marginPercent);
        });
        try {
            var producedPath = ExportToTemp(document, view, pixelSize, out var clamped);
            var modelRect = TryModelRect(view);
            return BuildResult(document, view, producedPath, clamped, modelRect, null);
        } finally {
            RunCropTransaction(document, "PE restore crop", () => {
                view.CropBox = originalCrop;
                view.CropBoxActive = originalActive;
                view.CropBoxVisible = originalVisible;
                // Re-assigning the scope box re-locks the crop to its extent (the original state).
                if (originalScopeId != ElementId.InvalidElementId) scopeParam!.Set(originalScopeId);
            });
        }
    }

    private static void RunCropTransaction(Document document, string name, Action apply) {
        using var transaction = new Transaction(document, name);
        if (transaction.Start() != TransactionStatus.Started)
            throw new InvalidOperationException($"'{name}' transaction could not start.");
        apply();
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException(
                $"'{name}' transaction did not commit (a Revit failure/warning likely rolled it back).");
    }

    /// <summary>
    ///     Sheeted-schedule capture: export the sheet, then pixel-crop to the schedule
    ///     instance's outline. WYSIWYG — the schedule renders exactly as placed.
    /// </summary>
    public static RevitViewImageData ExportSheetedSchedule(
        Document document,
        ViewSheet sheet,
        ScheduleSheetInstance instance,
        double marginPercent,
        int pixelSize
    ) {
        // ponytail: union of split-schedule segments on this sheet, not per-segment capture.
        var box = instance.get_BoundingBox(sheet)
                  ?? throw new InvalidOperationException($"Schedule instance {instance.Id.Value()} has no bounding box on sheet '{sheet.SheetNumber}'.");
        var outline = sheet.Outline;
        double sheetW = outline.Max.U - outline.Min.U, sheetH = outline.Max.V - outline.Min.V;
        double fracW = (box.Max.X - box.Min.X) / sheetW, fracH = (box.Max.Y - box.Min.Y) / sheetH;

        // Export the sheet large enough that the cropped schedule still has ~pixelSize resolution.
        var sheetPixel = (int)Math.Min(8000, Math.Ceiling(pixelSize / Math.Max(0.01, Math.Max(fracW, fracH))));
        var sheetPath = ExportToTemp(document, sheet, sheetPixel, out _);

        var croppedPath = CropSheetPng(sheetPath, outline, box, marginPercent);
        var schedule = (ViewSchedule)document.GetElement(instance.ScheduleId);
        return BuildResult(document, schedule, croppedPath, pixelSize, null, sheet.SheetNumber);
    }

    private static void ApplyCrop(View view, BoundingBoxXYZ modelBox, double marginPercent) {
        var cropBox = view.CropBox;
        var toView = cropBox.Transform.Inverse;
        // XY corners at one representative Z, like Annotate: transforming the full 3D corner
        // set lets the bbox Z range pollute the crop XY on rotated/transformed crops.
        var zMid = (modelBox.Min.Z + modelBox.Max.Z) / 2.0;
        var corners = new[] {
                new XYZ(modelBox.Min.X, modelBox.Min.Y, zMid),
                new XYZ(modelBox.Max.X, modelBox.Min.Y, zMid),
                new XYZ(modelBox.Min.X, modelBox.Max.Y, zMid),
                new XYZ(modelBox.Max.X, modelBox.Max.Y, zMid)
            }
            .Select(toView.OfPoint).ToList();
        double minX = corners.Min(p => p.X), maxX = corners.Max(p => p.X);
        double minY = corners.Min(p => p.Y), maxY = corners.Max(p => p.Y);
        var margin = Math.Max(maxX - minX, maxY - minY) * marginPercent / 100.0;
        cropBox.Min = new XYZ(minX - margin, minY - margin, cropBox.Min.Z);
        cropBox.Max = new XYZ(maxX + margin, maxY + margin, cropBox.Max.Z);
        view.CropBox = cropBox;
        view.CropBoxActive = true;
        view.CropBoxVisible = false;
    }

    private static IEnumerable<XYZ> Corners(BoundingBoxXYZ box) {
        var transform = box.Transform;
        foreach (var x in new[] { box.Min.X, box.Max.X })
        foreach (var y in new[] { box.Min.Y, box.Max.Y })
        foreach (var z in new[] { box.Min.Z, box.Max.Z })
            yield return transform.OfPoint(new XYZ(x, y, z));
    }

    /// <summary>Model-space XY extent of the view's crop box, when crop is active.</summary>
    private static RevitViewImageModelRect? TryModelRect(View view) {
        try {
            if (view is ViewSheet || !view.CropBoxActive) return null;
            var corners = Corners(view.CropBox).ToList();
            return new RevitViewImageModelRect(
                corners.Min(p => p.X),
                corners.Min(p => p.Y),
                corners.Max(p => p.X),
                corners.Max(p => p.Y)
            );
        } catch {
            return null;
        }
    }

    private static string CropSheetPng(string sheetPath, BoundingBoxUV outline, BoundingBoxXYZ box, double marginPercent) {
        BitmapFrame frame;
        using (var stream = File.OpenRead(sheetPath)) {
            frame = BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
        }

        double sheetW = outline.Max.U - outline.Min.U, sheetH = outline.Max.V - outline.Min.V;
        var margin = Math.Max(box.Max.X - box.Min.X, box.Max.Y - box.Min.Y) * marginPercent / 100.0;
        double PxX(double u) => (u - outline.Min.U) / sheetW * frame.PixelWidth;
        double PxY(double v) => (outline.Max.V - v) / sheetH * frame.PixelHeight; // image Y is flipped
        var left = (int)Math.Max(0, Math.Floor(PxX(box.Min.X - margin)));
        var top = (int)Math.Max(0, Math.Floor(PxY(box.Max.Y + margin)));
        var right = (int)Math.Min(frame.PixelWidth, Math.Ceiling(PxX(box.Max.X + margin)));
        var bottom = (int)Math.Min(frame.PixelHeight, Math.Ceiling(PxY(box.Min.Y - margin)));
        if (right - left < 2 || bottom - top < 2)
            throw new InvalidOperationException("Schedule crop rectangle is degenerate; capture the whole sheet instead.");

        var cropped = new CroppedBitmap(frame, new System.Windows.Int32Rect(left, top, right - left, bottom - top));
        var croppedPath = Path.Combine(
            Path.GetDirectoryName(sheetPath)!,
            Path.GetFileNameWithoutExtension(sheetPath) + "-schedule.png"
        );
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(cropped));
        using (var output = File.Create(croppedPath)) {
            encoder.Save(output);
        }

        File.Delete(sheetPath);
        return croppedPath;
    }

    private static string ExportToTemp(Document document, View view, int pixelSize, out int clampedPixelSize) {
        clampedPixelSize = Math.Min(Math.Max(pixelSize, 100), 8000);
        var outputDirectory = Path.Combine(Path.GetTempPath(), "pe-view-captures");
        var baseName = $"view-{view.Id.Value()}-{Guid.NewGuid():N}";
        return ExportPng(document, view.Id, outputDirectory, baseName, clampedPixelSize);
    }

    private static RevitViewImageData BuildResult(
        Document document,
        View view,
        string producedPath,
        int pixelSize,
        RevitViewImageModelRect? modelRect,
        string? sheetNumber
    ) {
        var kind = view switch {
            ViewSheet => RevitAgentContextHandleKind.Sheet,
            ViewSchedule => RevitAgentContextHandleKind.Schedule,
            _ => RevitAgentContextHandleKind.View
        };
        var handle = new RevitAgentContextHandle(
            kind,
            document.GetDocumentKey(),
            view.Id.Value(),
            view.UniqueId,
            view.Name
        );
        int? scale = null;
        try {
            if (view is not ViewSheet && view.Scale > 0) scale = view.Scale;
        } catch {
            // some view kinds throw on Scale; leave null
        }

        return new RevitViewImageData(
            handle,
            producedPath,
            new FileInfo(producedPath) is { Exists: true } file ? file.Length : 0,
            pixelSize,
            scale,
            modelRect,
            sheetNumber
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
