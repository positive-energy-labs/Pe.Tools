using Newtonsoft.Json.Linq;
using Pe.App.Host;

namespace Pe.Revit.Tests;

/// <summary>
///     PROBES for the two FamilyProjectIdentityTests failures that also fail at base 4621e0a (domains-opus ruling 4): product defect
///     or stale assertion. Each prints its facts in the pass message; no verdict is asserted.
/// </summary>
[TestFixture]
public sealed class FamilyIdentityFailureProbeTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    // Each test leaves the session's open documents as it found them (Mission 5 hold: a leftover changed a later test's reading).
    private Document[] _before = [];

    [SetUp]
    public void RecordOpenDocuments() => this._before = this._ui.Application.Documents.Cast<Document>().ToArray();

    [TearDown]
    public void GuardOpenDocuments() => RevitFamilyFixtureHarness.CloseLeftoverDocuments(this._ui.Application, this._before);

    /// <summary>`…same_name_external_editor`: does EditFamily hand back the user's open, unsaved editor instead of a copy?</summary>
    [Test]
    public void Probe_EditFamily_with_a_same_name_editor_open() {
        const string parameterName = "Identity Probe";
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Probe_EditFamily_with_a_same_name_editor_open));
        var path = Path.Combine(directory, "PE Identity.rfa");
        Document? project = null, editor = null, copy = null;
        try {
            editor = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_GenericModel, "PE Identity");
            using (var tx = new Transaction(editor, "Seed")) {
                tx.Start();
                RevitFamilyFixtureHarness.EnsureFamilyType(editor, "Standard");
                editor.FamilyManager.Set(editor.FamilyManager.AddParameter(parameterName, GroupTypeId.Data, SpecTypeId.Number, false), 3.0);
                tx.Commit();
            }
            editor.SaveAs(path);
            editor.Close(false);
            project = RevitFamilyFixtureHarness.CreateProjectDocument(application);
            var family = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, project, path);
            editor = application.OpenDocumentFile(path);
            using (var tx = new Transaction(editor, "Unsaved external editor change")) {
                tx.Start();
                editor.FamilyManager.Set(editor.FamilyManager.get_Parameter(parameterName), 7.0);
                tx.Commit();
            }
            copy = project.EditFamily(family);
            double Value(Document d) => d.FamilyManager.CurrentType.AsDouble(d.FamilyManager.get_Parameter(parameterName)) ?? double.NaN;
            var line = $"[PE_IDENTITY_PROBE] editor: same={ReferenceEquals(copy, editor) || copy.Equals(editor)} copyTitle='{copy.Title}' copyPath='{copy.PathName}' " +
                       $"copyModified={copy.IsModified} copyValue={Value(copy)} editorTitle='{editor.Title}' editorValue={Value(editor)} " +
                       $"openDocs={string.Join(",", application.Documents.Cast<Document>().Select(d => $"'{d.Title}'"))}";
            Console.WriteLine(line);
            Assert.Pass(line);
        } finally {
            if (copy is { IsValidObject: true } && !copy.Equals(editor)) copy.Close(false);
            if (editor is { IsValidObject: true }) editor.Close(false);
            if (project is { IsValidObject: true }) project.Close(false);
        }
    }

    /// <summary>`…local_parameter_when_builtin_has_same_name`: which lookup-table facts make the capture Partial (section or key)?</summary>
    [Test, Timeout(300000)]
    public void Probe_lookup_table_unmodeled_facts_of_the_Linear_LED_family() {
        const string familyName = "Linear LED_Lighting Channel Wire";
        var application = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Probe_lookup_table_unmodeled_facts_of_the_Linear_LED_family));
        var path = Path.Combine(directory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), path, true);
        var project = application.OpenDocumentFile(path);
        try {
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            var capture = FamilyFoundryBridgeOps.CaptureFamilies([family.Id.Value()], project).Families.Single();
            var model = JObject.Parse(capture.ModelJson!);
            var facts = model.Descendants().OfType<JObject>()
                .Where(o => (string?)o["path"] is { } p && p.StartsWith("$.lookupTables", StringComparison.Ordinal))
                .Select(o => o.ToString(Newtonsoft.Json.Formatting.None)).Distinct().ToList();
            var tables = (model["lookupTables"] as JObject)?.Properties().Select(p => p.Name).ToList() ?? [];
            var line = $"[PE_IDENTITY_PROBE] lookup: coverage={capture.Coverage.GetValueOrDefault("lookupTables")} tables=[{string.Join(", ", tables)}] facts={string.Join(" | ", facts)}";
            Console.WriteLine(line);
            Assert.Pass(line);
        } finally { project.Close(false); }
    }
}
