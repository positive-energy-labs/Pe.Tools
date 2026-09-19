using System.IO;
using System.Windows.Media.Imaging;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.AgentContext;

/// <summary>
///     Exports a graphical view or sheet to a PNG file so agents can visually inspect it.
///     Captures views exactly as configured — templates, VG overrides, and temporary
///     hide/isolate all apply. Never creates or permanently mutates views.
///     Whole-view capture needs no transaction (safe on read-only documents); focus capture
///     sets a temporary crop box (clearing any scope box) then restores it (editable doc only).
///     Sheet-filtered schedules get their filter temporarily lifted the same way (editable doc only).
/// </summary>
public static class RevitViewImageExporter {
    public static RevitViewImageData Export(Document document, View view, int pixelSize) {
        var producedPath = ExportCropped(document, view, pixelSize, out var clamped);
        return BuildResult(document, view, producedPath, clamped, TryModelRect(view), null, TryRegistration(view, producedPath));
    }

    /// <summary>
    ///     ExportImage fits the view's whole EXTENT, not its crop: annotations and datums the crop does not clip (a grid or
    ///     text far outside) widen it, so the PNG no longer covers the crop and cannot be registered (D4, project-a Pool House: an
    ///     84 x 84 ft crop exported 1500 x 2171 px with the plan in one corner). Those elements draw nothing inside the export
    ///     window, so they are hidden inside a rollback sandbox for the export and never reach the document. An element that
    ///     crosses the window still widens it; the registration's aspect gate refuses that honestly.
    /// </summary>
    private static string ExportCropped(Document document, View view, int pixelSize, out int clampedPixelSize) {
        if (view is ViewSheet || !view.CropBoxActive || document.IsReadOnly)
            return ExportToTemp(document, view, pixelSize, out clampedPixelSize);
        using var sandbox = DocumentSandbox.BeginRollback(document, "view-image export window");
        var outside = OutsideExportWindow(document, view);
        // A view Revit will not let us touch (e.g. owned by another user) exports as is; the aspect gate then decides.
        try {
            if (outside.Count > 0) {
                view.HideElements(outside);
                document.Regenerate();
            }
        } catch (Autodesk.Revit.Exceptions.ApplicationException) { }
        return ExportToTemp(document, view, pixelSize, out clampedPixelSize);
    }

    /// <summary>
    ///     Annotation and datum elements whose view bounding box misses the model crop. The window is the model crop even with
    ///     annotation crop on: hold 5d0124e/88746ed showed an annotation-crop view with nothing past the model crop exports exactly
    ///     the model crop, so anything drawn between the two crops would only widen the image past what registration can place.
    /// </summary>
    private static List<ElementId> OutsideExportWindow(Document document, View view) {
        var crop = view.CropBox;
        var toCrop = crop.Transform.Inverse;
        double minX = crop.Min.X, maxX = crop.Max.X, minY = crop.Min.Y, maxY = crop.Max.Y;
        return new FilteredElementCollector(document, view.Id).WhereElementIsNotElementType()
            .Where(e => e.Category is { CategoryType: CategoryType.Annotation } category
                        && category.BuiltInCategory != BuiltInCategory.OST_CropBoundary && e.CanBeHidden(view))
            .Where(e => e.get_BoundingBox(view) is { } box && Corners(box).Select(toCrop.OfPoint).ToList() is var p
                        && (p.Max(q => q.X) < minX || p.Min(q => q.X) > maxX || p.Max(q => q.Y) < minY || p.Min(q => q.Y) > maxY))
            .Select(e => e.Id).ToList();
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

        // set → export → restore with committed transactions, NOT a rollback that unwinds itself.
        // What ExportImage renders relative to in-flight transactions was live-proven twice
        // (project-a 2026-07, Old_Template spike 2026-07-30, Revit 2025) and splits by change kind:
        //   - inside an open TransactionGroup: pre-group state, even after inner commits — never usable;
        //   - inside an open plain Transaction + Regenerate: element/annotation mutations and
        //     ScheduleDefinition.IsFilteredBySheet flips DO render (DocumentSandbox.BeginRollback is
        //     viable for those — see the sheeted-schedule path);
        //   - CropBox writes do NOT render until committed — which forces THIS committed dance,
        //     restore transaction and all. Do not "simplify" it back to a rollback sandbox.
        // Perf is not a reason to prefer either shape: a commit regenerates just like an explicit
        // Regenerate, and both regen + rollback are noise next to the export itself (measured
        // 2-6ms + 12-23ms vs ~300ms export on a small model).
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
            var producedPath = ExportCropped(document, view, pixelSize, out var clamped);
            // Read while the temporary crop is still set: it is the crop the image was exported with.
            return BuildResult(document, view, producedPath, clamped, TryModelRect(view), null, TryRegistration(view, producedPath));
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
    ///     instance's outline. When the schedule is filtered by sheet, the filter is
    ///     temporarily lifted (set → export → restore, like focus capture) so the image
    ///     shows the FULL schedule, not the one-sheet slice the placement happens to render.
    /// </summary>
    public static RevitViewImageData ExportSheetedSchedule(
        Document document,
        ViewSheet sheet,
        ScheduleSheetInstance instance,
        double marginPercent,
        int pixelSize
    ) {
        var schedule = (ViewSchedule)document.GetElement(instance.ScheduleId);
        if (!schedule.Definition.IsFilteredBySheet)
            return ExportSheetedScheduleCore(document, sheet, instance, marginPercent, pixelSize);

        if (document.IsReadOnly)
            throw new InvalidOperationException(
                "This schedule is filtered by sheet; capturing its full contents needs an editable document (the filter is temporarily lifted during export).");

        // Unlike CropBox, an UNCOMMITTED IsFilteredBySheet flip does render in ExportImage
        // (live-proven 2026-07-30, Revit 2025), so this lift could equally run inside one
        // DocumentSandbox.BeginRollback (auto-unwind, no undo-stack entries, PeSandbox::-prefixed
        // churn the bridge ignores). Perf does not separate the shapes — commits regenerate too,
        // and flip-regen (2-6ms) + rollback (12-23ms) are noise against the ~300ms export.
        // Committed set → export → restore is kept for symmetry with the crop path above, where
        // it is the only shape that works.
        RunCropTransaction(document, "PE lift schedule sheet filter",
            () => schedule.Definition.IsFilteredBySheet = false);
        try {
            // Re-fetch: the instance regrows to full contents once the filter is lifted.
            var fullInstance = (ScheduleSheetInstance)document.GetElement(instance.Id);
            return ExportSheetedScheduleCore(document, sheet, fullInstance, marginPercent, pixelSize);
        } finally {
            RunCropTransaction(document, "PE restore schedule sheet filter",
                () => schedule.Definition.IsFilteredBySheet = true);
        }
    }

    private static RevitViewImageData ExportSheetedScheduleCore(
        Document document,
        ViewSheet sheet,
        ScheduleSheetInstance instance,
        double marginPercent,
        int pixelSize
    ) {
        // ponytail: union of split-schedule segments on this sheet, not per-segment capture.
        // ponytail: an unfiltered instance can grow past the sheet outline; crop clamps to the
        // exported image, so overflow rows clip — temp oversized sheet if that bites in practice.
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
        return BuildResult(document, schedule, croppedPath, pixelSize, null, sheet.SheetNumber, (null, RevitViewImageRegistrationRefusal.NoCrop));
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

    /// <summary>Pixel-to-model registration from the crop box transform, so a rotated crop is placed honestly.</summary>
    private static (RevitViewImageRegistration?, RevitViewImageRegistrationRefusal?) TryRegistration(View view, string imagePath) {
        if (view is ViewSheet || !view.CropBoxActive) return (null, RevitViewImageRegistrationRefusal.NoCrop);
        if (!File.Exists(imagePath)) return (null, RevitViewImageRegistrationRefusal.NoImage);
        var crop = view.CropBox;
        var transform = crop.Transform;
        BitmapFrame frame;
        using (var stream = File.OpenRead(imagePath))
            frame = BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
        string sha;
        using (var stream = File.OpenRead(imagePath))
        using (var hash = System.Security.Cryptography.SHA256.Create())
            sha = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        return RevitViewImageRegistration.FromCrop(frame.PixelWidth, frame.PixelHeight, sha,
            (crop.Min.X, crop.Min.Y), (crop.Max.X, crop.Max.Y),
            (transform.Origin.X, transform.Origin.Y), (transform.BasisX.X, transform.BasisX.Y),
            (transform.BasisY.X, transform.BasisY.Y));
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
        string? sheetNumber,
        (RevitViewImageRegistration? Registration, RevitViewImageRegistrationRefusal? Refusal) registration
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
            sheetNumber,
            registration.Registration,
            registration.Refusal
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
