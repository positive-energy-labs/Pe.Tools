using Autodesk.Revit.DB.Events;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.Tests;

/// <summary>
///     F-J3-7 (projectA, Price LBP15A Exhaust): `EditFamily` on a loaded family posts `UnstableConstraintInFamily`. Plan opened
///     through the read policy and acknowledged it; apply opened bare, the warning became a DocWarnDialog, the engine
///     answered Cancel and Revit threw "Loaded Family Editing failed". Every open now goes through one gate.
/// </summary>
[TestFixture]
public sealed class FamilyOpenGateTests {
    private const string FamilyName = "FF open gate";
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    // Precondition (the red): a dimension labelled by a parameter between two extrusion faces constrains geometry to geometry,
    // and Revit posts UnstableConstraintInFamily when the loaded family opens. With no failure handling that warning reaches
    // the UI, which is where the engine's Cancel aborted EditFamily.
    [Test]
    public void Bare_EditFamily_of_a_geometry_constrained_family_posts_the_unstable_constraint_warning() {
        var (project, family) = this.LoadedFixture();
        var posted = new List<FailureDefinitionId>();
        void Record(object? _, FailuresProcessingEventArgs args) {
            var accessor = args.GetFailuresAccessor();
            if (accessor?.GetDocument()?.IsFamilyDocument == true)
                posted.AddRange(accessor.GetFailureMessages().Select(f => f.GetFailureDefinitionId()));
        }
        Document? copy = null;
        this._ui.Application.FailuresProcessing += Record;
        try {
            copy = project.EditFamily(family);
        } finally {
            this._ui.Application.FailuresProcessing -= Record;
            if (copy != null) _ = copy.Close(false);
            RevitFamilyFixtureHarness.CloseDocument(project);
        }
        Assert.That(posted, Does.Contain(BuiltInFailures.DimensionFailures.UnstableConstraintInFamily),
            "the fixture must reproduce the project-a open-time warning");
    }

    [Test]
    public void Apply_through_the_open_gate_acknowledges_the_warning_and_writes_the_value() {
        var (project, family) = this.LoadedFixture();
        try {
            var result = FamilyVisit.Run(project, family,
                scope => scope.Edit("set Url", d => d.FamilyManager.Set(d.FamilyManager.FindParameter("Url")!, "gate")));
            Assert.That(result.Ran, Is.True, result.Message);
            Assert.That(result.Verified, Is.True, result.Message);
            Assert.That(result.Diagnostics.Where(d => d.Edit == FamilyVisit.OpenEdit), Has.Some.Matches<(string Edit, bool IsError, string Message)>(d =>
                !d.IsError && d.Message.StartsWith("Acknowledged warning: Constraints between geometry", StringComparison.Ordinal)),
                "the open-time acknowledgement rides the diagnostics, so the receipt names it");
            var read = project.ReadFamilyCopy(result.Loaded!, d => d.FamilyManager.CurrentType!.AsString(d.FamilyManager.FindParameter("Url")!),
                new List<(bool IsError, string Message)>());
            Assert.That(read, Is.EqualTo("gate"));
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    private (Document Project, Family Family) LoadedFixture() {
        var app = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(FamilyOpenGateTests));
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(app, BuiltInCategory.OST_GenericModel, FamilyName);
        string path;
        try {
            using (var t = new Transaction(familyDocument, "Geometry-to-geometry constraint")) {
                _ = t.Start();
                var fm = familyDocument.FamilyManager;
                fm.CurrentType ??= fm.NewType("T");
                _ = fm.AddParameter("Url", GroupTypeId.IdentityData, SpecTypeId.String.Text, false);
                var gap = fm.AddParameter("Gap", GroupTypeId.Geometry, SpecTypeId.Length, false);
                var plane = SketchPlane.Create(familyDocument, Plane.CreateByNormalAndOrigin(XYZ.BasisZ, XYZ.Zero));
                var a = familyDocument.FamilyCreate.NewExtrusion(true, Rectangle(0), plane, 1.0);
                var b = familyDocument.FamilyCreate.NewExtrusion(true, Rectangle(2), plane, 1.0);
                familyDocument.Regenerate();
                var view = new FilteredElementCollector(familyDocument).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().First(v => !v.IsTemplate);
                var references = new ReferenceArray();
                references.Append(Face(a, XYZ.BasisX).Reference);
                references.Append(Face(b, -XYZ.BasisX).Reference);
                var dimension = familyDocument.FamilyCreate.NewLinearDimension(view, Line.CreateBound(new XYZ(1, 0.5, 0.5), new XYZ(2, 0.5, 0.5)), references);
                fm.Set(gap, 1.0);
                dimension.FamilyLabel = gap;
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            path = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, directory, FamilyName);
        } finally { RevitFamilyFixtureHarness.CloseDocument(familyDocument); }

        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        return (project, RevitFamilyFixtureHarness.LoadFamilyIntoProject(app, project, path));
    }

    private static CurveArrArray Rectangle(double x0) {
        XYZ P(double x, double y) => new(x0 + x, y, 0);
        var loop = new CurveArray();
        loop.Append(Line.CreateBound(P(0, 0), P(1, 0)));
        loop.Append(Line.CreateBound(P(1, 0), P(1, 1)));
        loop.Append(Line.CreateBound(P(1, 1), P(0, 1)));
        loop.Append(Line.CreateBound(P(0, 1), P(0, 0)));
        var profile = new CurveArrArray();
        profile.Append(loop);
        return profile;
    }

    private static PlanarFace Face(Extrusion extrusion, XYZ normal) =>
        extrusion.get_Geometry(new Options { ComputeReferences = true }).OfType<Solid>()
            .SelectMany(s => s.Faces.OfType<PlanarFace>()).Single(f => f.FaceNormal.IsAlmostEqualTo(normal));
}
