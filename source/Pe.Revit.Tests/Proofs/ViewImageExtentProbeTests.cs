using System.IO;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests;

/// <summary>
///     D4 rerun probe (HOLD 5 leg B: project-a Pool House, Lower Level, Gatehouse refused AspectDisagrees; the Guest House
///     registration and its zones are disjoint in raw model feet). Runs on the documents ALREADY OPEN in the session (it opens
///     nothing); ignored when none has a probed view. Per view it prints the crop frame, View.Outline (paper and model feet),
///     annotation crop, scope box, template, the aspect each candidate predicts against the plain export's PNG, what reaches past
///     the crop, and the product's registration quad. Per takeoff region (and `PE_VIEW_IMAGE_PROBE_REGIONS`) it prints the
///     owner view and whether the boundary lies in that view's crop. Every change is rolled back.
///     Views: `PE_VIEW_IMAGE_PROBE_VIEWS` (';'-separated names), default the four D4 zoning views.
/// </summary>
[TestFixture]
public sealed class ViewImageExtentProbeTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Probe_view_image_extent_on_the_open_views() {
        var names = List("PE_VIEW_IMAGE_PROBE_VIEWS",
            "Mechanical Zoning Plan - Pool House;Mechanical Zoning Plan - Lower Level;Mechanical Zoning Plan - Gatehouse;Mechanical Zoning Plan - Main Lvl Guest House Controls");
        var regionIds = List("PE_VIEW_IMAGE_PROBE_REGIONS", "10047387;10047400").Select(long.Parse).ToHashSet();
        var probed = 0;
        foreach (var doc in this._ui.Application.Documents.Cast<Document>().Where(d => !d.IsFamilyDocument && !d.IsLinked).ToList()) {
            var views = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Where(v => !v.IsTemplate && names.Contains(v.Name)).ToList();
            if (views.Count == 0) continue;
            probed++;
            foreach (var view in views) Probe(doc, view);
            Regions(doc, regionIds, views);
        }
        if (probed == 0) Assert.Ignore($"no open document has a view named {string.Join(" | ", names)}");
    }

    private static string[] List(string variable, string fallback) =>
        (Environment.GetEnvironmentVariable(variable) is { Length: > 0 } list ? list : fallback)
        .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>The crop frame (Min/Max in the box's own frame, then its transform) and View.Outline, raw and scaled.</summary>
    private static string Frame(View view) {
        var crop = view.CropBox;
        var t = crop.Transform;
        var outline = view.Outline;
        var scale = view.Scale;
        return $"crop active={view.CropBoxActive} min=({crop.Min.X:F3},{crop.Min.Y:F3},{crop.Min.Z:F3}) max=({crop.Max.X:F3},{crop.Max.Y:F3},{crop.Max.Z:F3}) " +
               $"size={crop.Max.X - crop.Min.X:F3}x{crop.Max.Y - crop.Min.Y:F3} origin=({t.Origin.X:F3},{t.Origin.Y:F3},{t.Origin.Z:F3}) " +
               $"basisX=({t.BasisX.X:F4},{t.BasisX.Y:F4}) basisY=({t.BasisY.X:F4},{t.BasisY.Y:F4}) angle={Math.Atan2(t.BasisX.Y, t.BasisX.X) * 180 / Math.PI:F3}; " +
               $"outline paper min=({outline.Min.U:F5},{outline.Min.V:F5}) max=({outline.Max.U:F5},{outline.Max.V:F5}) " +
               $"x scale {scale}: min=({outline.Min.U * scale:F3},{outline.Min.V * scale:F3}) max=({outline.Max.U * scale:F3},{outline.Max.V * scale:F3}) " +
               $"size={(outline.Max.U - outline.Min.U) * scale:F3}x{(outline.Max.V - outline.Min.V) * scale:F3}";
    }

    private static void Probe(Document doc, View view) {
        void Line(string text) => Console.WriteLine($"[PE_VIEW_IMAGE_PROBE] {view.Name}: {text}");
        var crop = view.CropBox;
        var toCrop = crop.Transform.Inverse;
        var template = doc.GetElement(view.ViewTemplateId);
        var scopeBox = view.get_Parameter(BuiltInParameter.VIEWER_VOLUME_OF_INTEREST_CROP)?.AsElementId() is { } scopeId ? doc.GetElement(scopeId) : null;
        Line($"doc='{doc.Title}' id={view.Id.Value()} type={view.ViewType} scale={view.Scale} readOnly={doc.IsReadOnly} " +
             $"dependentOf={view.GetPrimaryViewId().Value()} crop visible={view.CropBoxVisible} shapeEdited={Try(() => view.GetCropRegionShapeManager().ShapeSet)}");
        Line($"annotationCrop={view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE)?.AsInteger()} offsets(L/R/B/T in)=" +
             Try(() => { var m = view.GetCropRegionShapeManager(); return $"{m.LeftAnnotationCropOffset * 12:F2}/{m.RightAnnotationCropOffset * 12:F2}/{m.BottomAnnotationCropOffset * 12:F2}/{m.TopAnnotationCropOffset * 12:F2}"; }) +
             $" template={(template is null ? "none" : $"{template.Id.Value()} '{template.Name}'")} scopeBox={(scopeBox is null ? "none" : $"{scopeBox.Id.Value()} '{scopeBox.Name}'")} " +
             $"links={new FilteredElementCollector(doc, view.Id).OfClass(typeof(RevitLinkInstance)).GetElementCount()}");
        Line(Frame(view));

        // Plain export: the view exactly as it stands, nothing hidden. Aspect = width / height.
        var dir = Path.Combine(Path.GetTempPath(), "pe-view-image-probe");
        var plain = PngSize(RevitViewImageExporter.ExportPng(doc, view.Id, dir, $"plain-{view.Id.Value()}-{Guid.NewGuid():N}", 1500));
        var outline = view.Outline;
        Line($"aspect png={plain.Aspect:F4} ({plain.Text}) outline={(outline.Max.U - outline.Min.U) / (outline.Max.V - outline.Min.V):F4} " +
             $"crop={(crop.Max.X - crop.Min.X) / (crop.Max.Y - crop.Min.Y):F4}");

        // Elements the view collector returns that reach more than 1 ft past the crop (crop frame).
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
            rows.Add((e, x1 < minX || x0 > maxX || y1 < minY || y0 > maxY ? "outside" : "crossing", overhang));
        }
        foreach (var group in rows.GroupBy(r => (r.Where, Category: r.E.Category?.Name ?? "(none)", Type: r.E.Category?.CategoryType.ToString() ?? "-")))
            Line($"{group.Key.Where} {group.Key.Category} [{group.Key.Type}] x{group.Count()} max overhang {group.Max(r => r.Overhang):F1} ft");
        foreach (var r in rows.OrderByDescending(r => r.Overhang).Take(12))
            Line($"  top: {r.Where} {r.E.Id.Value()} {r.E.GetType().Name} '{r.E.Category?.Name}' '{r.E.Name}' overhang {r.Overhang:F1} ft canHide={r.E.CanBeHidden(view)}");
        var missing = new FilteredElementCollector(doc).OwnedByView(view.Id).WhereElementIsNotElementType().Where(e => !inView.Contains(e.Id)).ToList();
        Line($"view-owned elements the view collector misses: {missing.Count} {string.Join(", ", missing.GroupBy(e => e.Category?.Name ?? "(none)").Select(g => $"{g.Key} x{g.Count()}"))}");

        // What the product's far hide would do (rolled back): does it throw, and does the extent change?
        if (!doc.IsReadOnly) {
            using var tx = new Transaction(doc, "PE view-image probe");
            _ = tx.Start();
            var outside = rows.Where(r => r.Where == "outside" && r.E.Category is { CategoryType: CategoryType.Annotation } c
                                          && c.BuiltInCategory != BuiltInCategory.OST_CropBoundary && r.E.CanBeHidden(view)).Select(r => r.E.Id).ToList();
            string hide;
            try {
                if (outside.Count > 0) view.HideElements(outside);
                doc.Regenerate();
                hide = "ok";
            } catch (Exception e) { hide = $"{e.GetType().Name}: {e.Message}"; }
            Line($"hide {outside.Count} outside annotations: {hide}; export {PngSize(RevitViewImageExporter.ExportPng(doc, view.Id, dir, $"hidden-{view.Id.Value()}-{Guid.NewGuid():N}", 1500)).Text} " +
                 $"outline after={(view.Outline.Max.U - view.Outline.Min.U) * view.Scale:F3}x{(view.Outline.Max.V - view.Outline.Min.V) * view.Scale:F3}");
            _ = tx.RollBack();
        }
        var image = RevitViewImageExporter.Export(doc, view, 1500);
        var reg = image.Registration;
        Line($"product: png {PngSize(image.FilePath).Text} refusal={image.RegistrationRefusal} quad=" +
             (reg is null ? "none" : $"TL({reg.TopLeft[0]:F3},{reg.TopLeft[1]:F3}) TR({reg.TopRight[0]:F3},{reg.TopRight[1]:F3}) BL({reg.BottomLeft[0]:F3},{reg.BottomLeft[1]:F3}) {reg.Width}x{reg.Height}"));
    }

    /// <summary>Every takeoff region, plus the named ids: owner view, boundary box in model feet and in the owner's crop frame.</summary>
    private static void Regions(Document doc, HashSet<long> ids, List<View> probed) {
        var owners = new Dictionary<ElementId, View>();
        foreach (var region in new FilteredElementCollector(doc).OfClass(typeof(FilledRegion)).Cast<FilledRegion>()) {
            var (role, guid) = TakeoffCarriers.ReadIdentity(region);
            if (guid is null && !ids.Contains(region.Id.Value())) continue;
            var points = region.GetBoundaries().SelectMany(loop => loop.SelectMany(c => c.Tessellate())).ToList();
            var owner = doc.GetElement(region.OwnerViewId) as View;
            var text = $"[PE_VIEW_IMAGE_PROBE] region {region.Id.Value()} role={role ?? "-"} owner={region.OwnerViewId.Value()} '{owner?.Name}' " +
                       $"model x {points.Min(p => p.X):F3}..{points.Max(p => p.X):F3} y {points.Min(p => p.Y):F3}..{points.Max(p => p.Y):F3} z {points.Min(p => p.Z):F3}";
            if (owner is { CropBoxActive: true }) {
                owners[owner.Id] = owner;
                var crop = owner.CropBox;
                var local = points.Select(crop.Transform.Inverse.OfPoint).ToList();
                double x0 = local.Min(p => p.X), x1 = local.Max(p => p.X), y0 = local.Min(p => p.Y), y1 = local.Max(p => p.Y);
                var inside = x0 >= crop.Min.X - 0.01 && x1 <= crop.Max.X + 0.01 && y0 >= crop.Min.Y - 0.01 && y1 <= crop.Max.Y + 0.01;
                var overlaps = !(x1 < crop.Min.X || x0 > crop.Max.X || y1 < crop.Min.Y || y0 > crop.Max.Y);
                text += $"; owner crop frame x {x0:F3}..{x1:F3} y {y0:F3}..{y1:F3} vs crop x {crop.Min.X:F3}..{crop.Max.X:F3} y {crop.Min.Y:F3}..{crop.Max.Y:F3} inside={inside} overlaps={overlaps}";
            }
            Console.WriteLine(text);
        }
        foreach (var owner in owners.Values.Where(o => probed.All(p => p.Id != o.Id)))
            Console.WriteLine($"[PE_VIEW_IMAGE_PROBE] owner view {owner.Id.Value()} '{owner.Name}' scale={owner.Scale}: {Frame(owner)}");
    }

    private static string Try(Func<object> read) {
        try { return read().ToString() ?? "null"; } catch (Exception e) { return $"({e.GetType().Name})"; }
    }

    /// <summary>PNG width x height from the IHDR chunk.</summary>
    private static (double Aspect, string Text) PngSize(string path) {
        var b = File.ReadAllBytes(path);
        int Be(int at) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
        return ((double)Be(16) / Be(20), $"{Be(16)}x{Be(20)} {Path.GetFileName(path)}");
    }

    private static IEnumerable<XYZ> Corners(BoundingBoxXYZ box) {
        foreach (var x in new[] { box.Min.X, box.Max.X })
        foreach (var y in new[] { box.Min.Y, box.Max.Y })
        foreach (var z in new[] { box.Min.Z, box.Max.Z })
            yield return box.Transform.OfPoint(new XYZ(x, y, z));
    }
}
