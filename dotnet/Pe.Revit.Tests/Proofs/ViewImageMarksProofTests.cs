using System.IO;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.Operations;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>Documents the crop-frame pixel projection on real plan and orthographic 3D exports.</summary>
[TestFixture]
public sealed class ViewImageMarksProofTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [TestCase(false)]
    [TestCase(true)]
    public void Focus_marks_contain_each_elements_projected_centre(bool threeD) {
        var doc = RevitFamilyFixtureHarness.CreateProjectDocument(this._ui.Application);
        string? file = null;
        try {
            View view;
            var elements = new List<Element>();
            using (var tx = new Transaction(doc, "Seed two unequal solids")) {
                tx.Start();
                var level = Level.Create(doc, 0);
                var family = threeD ? ViewFamily.ThreeDimensional : ViewFamily.FloorPlan;
                var type = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType))
                    .Cast<ViewFamilyType>().First(t => t.ViewFamily == family);
                view = threeD ? View3D.CreateIsometric(doc, type.Id) : ViewPlan.Create(doc, type.Id, level.Id);
                view.ViewTemplateId = ElementId.InvalidElementId;
                foreach (var (min, max) in new[] {
                             (new XYZ(1000, 1000, 0), new XYZ(1002, 1003, 18)),
                             (new XYZ(1010, 1008, 0), new XYZ(1014, 1010, 3))
                         }) {
                    var corners = new[] { min, new XYZ(max.X, min.Y, min.Z), new XYZ(max.X, max.Y, min.Z), new XYZ(min.X, max.Y, min.Z) };
                    var loop = CurveLoop.Create(Enumerable.Range(0, 4)
                        .Select(i => (Curve)Line.CreateBound(corners[i], corners[(i + 1) % 4])).ToList());
                    var shape = DirectShape.CreateElement(doc, new ElementId(BuiltInCategory.OST_GenericModel));
                    shape.SetShape([GeometryCreationUtilities.CreateExtrusionGeometry([loop], XYZ.BasisZ, max.Z - min.Z)]);
                    elements.Add(shape);
                }
                Assert.That(tx.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            // Independent camera-basis projection. Keep every height corner: the tall solid hurts a mid-Z implementation.
            var bounds = elements.Select(e => e.get_BoundingBox(view)).ToList();
            var focus = new BoundingBoxXYZ {
                Min = new XYZ(bounds.Min(b => b.Min.X), bounds.Min(b => b.Min.Y), bounds.Min(b => b.Min.Z)),
                Max = new XYZ(bounds.Max(b => b.Max.X), bounds.Max(b => b.Max.Y), bounds.Max(b => b.Max.Z))
            };
            var right = view.RightDirection;
            var up = view.UpDirection;
            var corners3D = (from x in new[] { focus.Min.X, focus.Max.X }
                             from y in new[] { focus.Min.Y, focus.Max.Y }
                             from z in new[] { focus.Min.Z, focus.Max.Z }
                             select new XYZ(x, y, z)).ToList();
            var minX = corners3D.Min(p => p.DotProduct(right));
            var maxX = corners3D.Max(p => p.DotProduct(right));
            var minY = corners3D.Min(p => p.DotProduct(up));
            var maxY = corners3D.Max(p => p.DotProduct(up));
            const double marginPercent = 30;
            var margin = Math.Max(maxX - minX, maxY - minY) * marginPercent / 100;
            var image = RevitViewImageExporter.ExportFocused(doc, view, focus, marginPercent, 900,
                new SessionWrite(doc), elements.Select(e => e.Id.Value()).ToList());
            file = image.FilePath;
            Assert.That(image.Marks, Has.Count.EqualTo(2));
            Assert.That(image.Restore?.Held, Is.True);
            Assert.That(image.Width, Is.EqualTo(900).Within(15), "ExportPng fits the horizontal side");
            foreach (var element in elements) {
                var box = element.get_BoundingBox(view);
                var centre = box.Transform.OfPoint((box.Min + box.Max) / 2);
                var x = (centre.DotProduct(right) - minX + margin) / (maxX - minX + 2 * margin) * image.Width;
                var y = (maxY + margin - centre.DotProduct(up)) / (maxY - minY + 2 * margin) * image.Height;
                var mark = image.Marks.Single(m => m.ElementId == element.Id.Value());
                AssertContains(mark, x, y);
                Console.WriteLine($"[PE_VIEW_IMAGE_MARK] threeD={threeD} id={mark.ElementId} centre={x:F2},{y:F2} mark={mark}");

                // Named mutant: return a box displaced to the right of its element. The same guard must go red.
                var mutant = mark with { Left = (int)Math.Ceiling(x) + 10 };
                var red = Assert.Throws<AssertionException>(() => AssertContains(mutant, x, y));
                Console.WriteLine($"[PE_VIEW_IMAGE_MARK_MUTANT_RED] displaced-element-box: {red!.Message}");
            }
        } finally {
            doc.Close(false);
            if (file is not null) File.Delete(file);
        }
    }

    private static void AssertContains(RevitViewImageMark mark, double x, double y) {
        Assert.That(x, Is.InRange((double)mark.Left, mark.Left + mark.Width), $"element {mark.ElementId} projected centre X");
        Assert.That(y, Is.InRange((double)mark.Top, mark.Top + mark.Height), $"element {mark.ElementId} projected centre Y");
    }
}
