using Newtonsoft.Json.Linq;
using Pe.App.Host;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyProjectIdentityTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Project_plan_and_capture_ignore_modified_same_name_external_editor() {
        const string parameterName = "Identity Probe";
        const string patch = """{"patch":{"parameters":{"Identity Probe":{"dataType":"Number","value":7}}}}""";
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(FamilyProjectIdentityTests));
        var path = Path.Combine(directory, "PE Identity.rfa");
        var before = application.Documents.Cast<Document>().ToArray();
        Document? project = null;
        Document? editor = null;
        try {
            editor = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_GenericModel, "PE Identity");
            using (var tx = new Transaction(editor, "Seed identity baseline")) {
                tx.Start();
                RevitFamilyFixtureHarness.EnsureFamilyType(editor, "Standard");
                var parameter = editor.FamilyManager.AddParameter(parameterName, GroupTypeId.Data, SpecTypeId.Number, false);
                editor.FamilyManager.Set(parameter, 3.0);
                tx.Commit();
            }
            editor.SaveAs(path);
            editor.Close(false);
            editor = null;
            var originalBytes = File.ReadAllBytes(path);
            project = RevitFamilyFixtureHarness.CreateProjectDocument(application);
            var family = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, project, path);
            var id = family.Id.Value();
            var baseline = FamilyFoundryBridgeOps.ProjectFamilies(new FamilyFoundryProjectRequest([id]), project).Families.Single();
            Assert.That(baseline.Success, Is.True, baseline.Error);
            var snapshot = FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
            Assert.That(snapshot.IsPartial, Is.False);
            var baselineValue = snapshot.Parameters.Single(p => p.Definition.Identity.Name == parameterName).ValuesPerType["Standard"];

            editor = application.OpenDocumentFile(path);
            using (var tx = new Transaction(editor, "Unsaved external editor change")) {
                tx.Start();
                editor.FamilyManager.Set(editor.FamilyManager.get_Parameter(parameterName), 7.0);
                tx.Commit();
            }
            Assert.That(editor.Title, Does.Contain(family.Name), "The old name-based lookup must collide.");
            var open = application.Documents.Cast<Document>().ToArray();
            var plan = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, id), project).Families.Single();
            Assert.That(plan.Refusals, Is.Empty);
            Assert.That(plan.Changes.Any(c => c.Key == parameterName), Is.True, "Project baseline is 3; the unsaved editor's 7 must not produce a no-op.");
            var capture = FamilyFoundryBridgeOps.ProjectFamilies(new FamilyFoundryProjectRequest([id]), project).Families.Single();
            Assert.That(capture.Success, Is.True, capture.Error);
            Assert.That(capture.ModelJson, Is.EqualTo(baseline.ModelJson));
            var reread = FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
            Assert.That(reread.IsPartial, Is.False);
            Assert.That(reread.Parameters.Single(p => p.Definition.Identity.Name == parameterName).ValuesPerType["Standard"], Is.EqualTo(baselineValue));
            var editorPlan = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch), editor).Families.Single();
            Assert.That(editorPlan.Refusals, Is.Empty);
            Assert.That(editorPlan.Changes, Is.Empty, "Explicit family-document targeting must still read the editor's 7.");
            Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(open), "Readers must close only their own EditFamily copies.");
            Assert.That(editor.IsValidObject && editor.IsModified, Is.True);
            Assert.That(editor.FamilyManager.CurrentType.AsDouble(editor.FamilyManager.get_Parameter(parameterName)), Is.EqualTo(7.0));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(originalBytes), "No reader may save the external editor.");
            var symbol = (FamilySymbol)project.GetElement(family.GetFamilySymbolIds().Single());
            Assert.That(symbol.LookupParameter(parameterName).AsDouble(), Is.EqualTo(3.0), "No reader may load editor changes into the project.");

            // A native refusal must remain a refusal, rather than falling back to the unrelated editor.
            using (var tx = new Transaction(project, "Block EditFamily")) {
                tx.Start();
                var native = Assert.Throws<Autodesk.Revit.Exceptions.InvalidOperationException>(() => project.EditFamily(family));
                var refused = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, id), project).Families.Single();
                Assert.That(refused.Refusals.Single().Code, Is.EqualTo("FamilyEditRefused"));
                Assert.That(refused.Refusals.Single().Message, Is.EqualTo(native!.Message));
                tx.RollBack();
            }

            editor.Close(false);
            editor = null;
            var applied = FamilyFoundryBridgeOps.ApplyFamilies(new FamilyFoundryApplyRequest(patch, new Dictionary<long, string> { [id] = plan.PlanHash }), project).Receipts.Single();
            Assert.That(applied.Success && applied.Converged, Is.True, applied.Error + string.Join(";", applied.Errors));
            Assert.That(applied.Residue, Is.Empty);
            var replacement = project.GetElement(applied.FamilyId.ToElementId()) as Family;
            Assert.That(replacement, Is.Not.Null, "Receipt must identify the committed replacement, not an invalid pre-load Family.");
            Assert.That(applied.FamilyName, Is.EqualTo("PE Identity"));
            var repeat = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, applied.FamilyId), project).Families.Single();
            Assert.That(repeat.Changes, Is.Empty);
            Assert.That(repeat.Refusals, Is.Empty);
        } finally {
            if (editor is { IsValidObject: true }) editor.Close(false);
            if (project is { IsValidObject: true }) project.Close(false);
        }
        Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    [Test, Timeout(300000)]
    public void Project_capture_acknowledges_Alternator_warning_and_refuses_destructive_copy() {
        const string familyName = "Generator (150 kW - 200 kW)";
        const string patch = """{"patch":{}}""";
        var application = this._ui.Application;
        var before = application.Documents.Cast<Document>().ToArray();
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Project_capture_acknowledges_Alternator_warning_and_refuses_destructive_copy));
        var path = Path.Combine(directory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), path, true);
        Document? project = null;
        try {
            project = application.OpenDocumentFile(path);
            var families = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().ToList();
            var family = families.Single(candidate => candidate.Name == familyName);
            var titleBlock = families.Single(candidate => candidate.Name == "PE - Title Block");

            var generatorPlan = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, family.Id.Value()), project).Families.Single();
            var generatorRepeat = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, family.Id.Value()), project).Families.Single();
            var generatorCapture = FamilyFoundryBridgeOps.ProjectFamilies(new FamilyFoundryProjectRequest([family.Id.Value()]), project).Families.Single();
            var refusedPlan = FamilyFoundryBridgeOps.PlanFamilies(new FamilyFoundryPlanRequest(patch, titleBlock.Id.Value()), project).Families.Single();
            var refusedCapture = FamilyFoundryBridgeOps.ProjectFamilies(new FamilyFoundryProjectRequest([titleBlock.Id.Value()]), project).Families.Single();
            var lostDimensionId = BuiltInFailures.DimensionFailures.SomeDimensionsLostOnPaste.Guid.ToString();
            var deletedElementsId = BuiltInFailures.EditingFailures.ElementsDeleted.Guid.ToString();

            Assert.Multiple(() => {
                Assert.That(generatorPlan.Refusals, Is.Empty);
                Assert.That(generatorPlan.Changes, Is.Empty);
                Assert.That(generatorPlan.PlanHash, Is.Not.Empty.And.EqualTo(generatorRepeat.PlanHash));
                Assert.That(generatorPlan.Warnings.Any(warning => warning.FamilyName == "Alternator" &&
                    warning.Message.Contains("Acknowledged warning:", StringComparison.Ordinal) &&
                    warning.Message.Contains("elements:", StringComparison.Ordinal)), Is.True);
                Assert.That(generatorCapture.Success, Is.True, generatorCapture.Error);
                Assert.That(generatorCapture.Issues.Any(issue => issue.FamilyName == "Alternator"), Is.True);
                Assert.That(generatorCapture.ModelJson, Does.Not.Contain("FamilyEditWarning").And.Not.Contain("NativeEditWarning"));
                Assert.That(refusedPlan.PlanHash, Is.Empty);
                Assert.That(refusedPlan.Changes, Is.Empty);
                Assert.That(refusedPlan.Refusals.Single().Code, Is.EqualTo("FamilyEditRefused"));
                Assert.That(refusedPlan.Refusals.Single().Message, Does.Contain("Rejected warning:").And.Contain("elements:")
                    .And.Contain(lostDimensionId).And.Contain(deletedElementsId));
                Assert.That(refusedCapture.Success, Is.False);
                Assert.That(refusedCapture.ModelJson, Is.Null);
                Assert.That(refusedCapture.Error, Does.Contain("Rejected warning:").And.Contain("elements:")
                    .And.Contain(lostDimensionId).And.Contain(deletedElementsId));
                Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(before.Append(project)));
            });
        } finally {
            if (project is { IsValidObject: true }) project.Close(false);
        }
        Assert.That(application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    [Test, Timeout(300000)]
    public void Project_capture_preserves_local_parameter_when_builtin_has_same_name() {
        const string familyName = "Linear LED_Lighting Channel Wire";
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Project_capture_preserves_local_parameter_when_builtin_has_same_name));
        var path = Path.Combine(directory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), path, true);
        var project = application.OpenDocumentFile(path);
        try {
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            var capture = FamilyFoundryBridgeOps.ProjectFamilies(new FamilyFoundryProjectRequest([family.Id.Value()]), project).Families.Single();
            Assert.That(capture.Success, Is.True, capture.Error);
            var parameter = JObject.Parse(capture.ModelJson!)["parameters"]!["Default Elevation"];
            Assert.That(parameter, Is.Not.Null, "The authored String parameter must not be dropped with the same-named built-in length parameter.");
            Assert.That(parameter!.Value<string>("dataType"), Is.EqualTo("Text"));
        } finally { project.Close(false); }
    }
}
