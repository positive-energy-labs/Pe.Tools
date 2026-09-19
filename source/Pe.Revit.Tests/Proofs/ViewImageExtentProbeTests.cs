using System.IO;
using Pe.Revit.DocumentData.AgentContext;

namespace Pe.Revit.Tests;

/// <summary>
///     D4 rerun probe (HOLD 5 leg B: project-a Pool House, Lower Level, Gatehouse refused AspectDisagrees). Runs on views of the
///     documents ALREADY OPEN in the session (it opens nothing); ignored when none match. Per view it prints the crop, annotation
///     crop, scope box, template and links, the elements that reach past the crop, the plain export's PNG size, the size with
///     the far annotations hidden (and whether the hide threw), and the product's result. Every change is rolled back.
///     Views: `PE_VIEW_IMAGE_PROBE_VIEWS` (';'-separated names), default the three refused zoning views.
/// </summary>
[TestFixture]
public sealed class ViewImageExtentProbeTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Probe_view_image_extent_on_the_open_views() {
        var names = (Environment.GetEnvironmentVariable("PE_VIEW_IMAGE_PROBE_VIEWS") is { Length: > 0 } list
                ? list
                : "Mechanical Zoning Plan - Pool House;Mechanical Zoning Plan - Lower Level;Mechanical Zoning Plan - Gatehouse")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var probed = 0;
        foreach (var doc in this._ui.Application.Documents.Cast<Document>().Where(d => !d.IsFamilyDocument && !d.IsLinked).ToList())
        foreach (var view in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
                     .Where(v => !v.IsTemplate && names.Contains(v.Name)).ToList()) {
            probed++;
            Probe(doc, view);
        }
        if (probed == 0) Assert.Ignore($"no open document has a view named {string.Join(" | ", names)}");
    }

    private static void Probe(Document doc, View view) {
        void Line(string text) => Console.WriteLine($"[PE_VIEW_IMAGE_PROBE] {view.Name}: {text}");
        var crop = view.CropBox;
        var toCrop = crop.Transform.Inverse;
        var basis = crop.Transform.BasisX;
        var template = doc.GetElement(view.ViewTemplateId);
        var scopeBox = view.get_Parameter(BuiltInParameter.VIEWER_VOLUME_OF_INTEREST_CROP)?.AsElementId() is { } scopeId ? doc.GetElement(scopeId) : null;
        var annotationCrop = view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE)?.AsInteger();
        Line($"doc='{doc.Title}' id={view.Id.Value()} type={view.ViewType} scale={view.Scale} readOnly={doc.IsReadOnly}");
        Line($"crop active={view.CropBoxActive} visible={view.CropBoxVisible} local={crop.Max.X - crop.Min.X:F2}x{crop.Max.Y - crop.Min.Y:F2} " +
             $"angle={Math.Atan2(basis.Y, basis.X) * 180 / Math.PI:F2} shapeEdited={Try(() => view.GetCropRegionShapeManager().ShapeSet)} " +
             $"annotationCrop={annotationCrop} offsets(L/R/B/T in)={Try(() => { var m = view.GetCropRegionShapeManager(); return $"{m.LeftAnnotationCropOffset * 12:F2}/{m.RightAnnotationCropOffset * 12:F2}/{m.BottomAnnotationCropOffset * 12:F2}/{m.TopAnnotationCropOffset * 12:F2}"; })}");
        Line($"template={(template is null ? "none" : $"{template.Id.Value()} '{template.Name}'")} scopeBox={(scopeBox is null ? "none" : $"{scopeBox.Id.Value()} '{scopeBox.Name}'")} " +
             $"links={new FilteredElementCollector(doc, view.Id).OfClass(typeof(RevitLinkInstance)).GetElementCount()}");

        // Every element the view collector returns, by where its view box sits against the crop (crop-local feet).
        double minX = crop.Min.X, maxX = crop.Max.X, minY = crop.Min.Y, maxY = crop.Max.Y;
        var rows = new List<(Element E, string Where, double Overhang)>();
        var inView = new HashSet<ElementId>();
        foreach (var e in new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType()) {
            inView.Add(e.Id);
            if (e.get_BoundingBox(view) is not { } box) continue;
            var p = Corners(box).Select(toCrop.OfPoint).ToList();
            double x0 = p.Min(q => q.X), x1 = p.Max(q => q.X), y0 = p.Min(q => q.Y), y1 = p.Max(q => q.Y);
            var overhang = new[] { minX - x0, x1 - maxX, minY - y0, y1 - maxY }.Max();
            if (overhang <= 1) continue;
            var outside = x1 < minX || x0 > maxX || y1 < minY || y0 > maxY;
            rows.Add((e, outside ? "outside" : "crossing", overhang));
        }
        foreach (var group in rows.GroupBy(r => (r.Where, Category: r.E.Category?.Name ?? "(none)", Type: r.E.Category?.CategoryType.ToString() ?? "-")))
            Line($"{group.Key.Where} {group.Key.Category} [{group.Key.Type}] x{group.Count()} max overhang {group.Max(r => r.Overhang):F1} ft");
        foreach (var r in rows.OrderByDescending(r => r.Overhang).Take(12))
            Line($"  top: {r.Where} {r.E.Id.Value()} {r.E.GetType().Name} '{r.E.Category?.Name}' '{r.E.Name}' overhang {r.Overhang:F1} ft canHide={r.E.CanBeHidden(view)}");
        // Owned by this view but not returned by its collector (the product's hide can only see what the collector returns).
        var missing = new FilteredElementCollector(doc).OwnedByView(view.Id).WhereElementIsNotElementType().Where(e => !inView.Contains(e.Id)).ToList();
        Line($"view-owned elements the view collector misses: {missing.Count} {string.Join(", ", missing.GroupBy(e => e.Category?.Name ?? "(none)").Select(g => $"{g.Key} x{g.Count()}"))}");
        var datums = new FilteredElementCollector(doc).OfClass(typeof(DatumPlane)).Where(e => !inView.Contains(e.Id) && e.get_BoundingBox(view) is not null).ToList();
        Line($"datums with a view box the view collector misses: {datums.Count}");

        var dir = Path.Combine(Path.GetTempPath(), "pe-view-image-probe");
        using (var tx = new Transaction(doc, "PE view-image probe")) {
            _ = tx.Start();
            Line($"plain export {PngSize(RevitViewImageExporter.ExportPng(doc, view.Id, dir, $"plain-{view.Id.Value()}-{Guid.NewGuid():N}", 1500))}");
            var annotationsOutside = rows.Where(r => r.Where == "outside" && r.E.Category is { CategoryType: CategoryType.Annotation } c
                                                     && c.BuiltInCategory != BuiltInCategory.OST_CropBoundary && r.E.CanBeHidden(view)).Select(r => r.E.Id).ToList();
            string hide;
            try {
                if (annotationsOutside.Count > 0) view.HideElements(annotationsOutside);
                doc.Regenerate();
                hide = "ok";
            } catch (Exception e) { hide = $"{e.GetType().Name}: {e.Message}"; }
            Line($"hide {annotationsOutside.Count} outside annotations: {hide}; export {PngSize(RevitViewImageExporter.ExportPng(doc, view.Id, dir, $"hidden-{view.Id.Value()}-{Guid.NewGuid():N}", 1500))}");
            var all = rows.Where(r => r.E.CanBeHidden(view) && r.E.Category?.BuiltInCategory != BuiltInCategory.OST_CropBoundary).Select(r => r.E.Id).ToList();
            try {
                if (all.Count > 0) view.HideElements(all);
                doc.Regenerate();
                hide = "ok";
            } catch (Exception e) { hide = $"{e.GetType().Name}: {e.Message}"; }
            Line($"hide ALL {all.Count} reaching past the crop (crossing too): {hide}; export {PngSize(RevitViewImageExporter.ExportPng(doc, view.Id, dir, $"all-{view.Id.Value()}-{Guid.NewGuid():N}", 1500))}");
            _ = tx.RollBack();
        }
        var image = RevitViewImageExporter.Export(doc, view, 1500);
        Line($"product: png {PngSize(image.FilePath)} registered={image.Registration is not null} refusal={image.RegistrationRefusal} file={image.FilePath}");
    }

    private static string Try(Func<object> read) {
        try { return read().ToString() ?? "null"; } catch (Exception e) { return $"({e.GetType().Name})"; }
    }

    /// <summary>PNG width x height from the IHDR chunk.</summary>
    private static string PngSize(string path) {
        var b = File.ReadAllBytes(path);
        int Be(int at) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
        return $"{Be(16)}x{Be(20)} ({Path.GetFileName(path)})";
    }

    private static IEnumerable<XYZ> Corners(BoundingBoxXYZ box) {
        foreach (var x in new[] { box.Min.X, box.Max.X })
        foreach (var y in new[] { box.Min.Y, box.Max.Y })
        foreach (var z in new[] { box.Min.Z, box.Max.Z })
            yield return box.Transform.OfPoint(new XYZ(x, y, z));
    }
}
