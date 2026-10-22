using Pe.Revit.Global.Lib;
using Pe.Revit.Rfa;

namespace Pe.Revit.Tests;

/// <summary>
///     The Revit entry to the .rfa label reader: a tag family loaded into a project, read through EditFamily → SaveAs → read,
///     with built-in names from this Revit's <c>BuiltInParameter</c> enum. The byte-level segments are pinned deterministically in
///     Pe.Shared.Tests (RfaLabelsTests); this proves the loaded-family path and the enum names.
/// </summary>
[TestFixture]
public sealed class FamilyLabelsTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Reads_a_loaded_tag_family_s_labels_with_builtin_names() {
        var app = this._ui.Application;
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            var family = RevitFamilyFixtureHarness.LoadFamilyFixtureIntoProject(app, project, Path.Combine("TagLabels", "Tag_Zone.rfa"));

            var (labels, error) = family.ReadLabels();

            Assert.That(error, Is.Null, error?.ToString());
            Assert.That(labels!.Select(l => l.Container), Is.All.EqualTo(RfaLabelContainer.Host));
            Assert.That(labels.Select(l => l.Visibility?.Name), Is.EqualTo(new[] { "ZoneName_Trans", "ZoneNamePLUS_Trans", "ZoneName", "ZoneNamePLUS" }));
            var plus = labels[1].Segments;
            Assert.That(plus.Select(s => (s.Param.Kind, s.Param.Name, s.LineBreak)), Is.EqualTo(new[] {
                (RfaParamKind.BuiltIn, "ZONE_NAME", false),
                (RfaParamKind.Shared, "Sensible Cooling Load", true),
                (RfaParamKind.Shared, "Specified Supply Cooling Airflow", true)
            }));
            Assert.That(plus[0].Param.Id, Is.EqualTo((long)BuiltInParameter.ZONE_NAME));
            Assert.That(plus[1].Param.SharedGuid, Is.EqualTo(new Guid("9c9ad437-4366-4151-b2d8-cd929378e227")));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(project);
        }
    }

    /// <summary>
    ///     The project-file route and its guard: the saved file's BasicFileInfo identity equals Document.GetDocumentVersion, the
    ///     file read equals the per-family EditFamily read (same label ids), and an unsaved change sends the read per family.
    /// </summary>
    [Test]
    public void Project_file_read_agrees_with_EditFamily_and_falls_back_when_modified() {
        var app = this._ui.Application;
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(FamilyLabelsTests));
        try {
            var family = RevitFamilyFixtureHarness.LoadFamilyFixtureIntoProject(app, project, Path.Combine("TagLabels", "Tag_Zone.rfa"));
            var path = Path.Combine(directory, "labels-project.rvt");
            project.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });

            var (file, versionError) = RfaLabels.ReadVersion(path);
            var open = Document.GetDocumentVersion(project);
            TestContext.Progress.WriteLine($"[PE_RVT_VERSION] file={file} document={open.VersionGUID}/{open.NumberOfSaves} modified={project.IsModified}");
            Assert.That(versionError, Is.Null, versionError?.ToString());
            Assert.That((file!.VersionGuid, file.Saves), Is.EqualTo((open.VersionGUID, open.NumberOfSaves)));

            var (perFamily, perFamilyError) = family.ReadLabels();
            Assert.That(perFamilyError, Is.Null, perFamilyError?.ToString());
            var (fromFile, fileError) = project.ReadFamilyLabels(name => name == family.Name);
            Assert.That(fileError, Is.Null, fileError?.ToString());
            Assert.That(fromFile!.Version, Is.EqualTo(file), "an unmodified local document reads its file");
            var zone = fromFile.Families.Single();
            Assert.That((zone.Name, zone.FamilyId), Is.EqualTo((family.Name, family.Id.Value())));
            Assert.That(Project(zone.Labels), Is.EqualTo(Project(perFamily!)), "the project file holds what EditFamily reads");

            using (var t = new Transaction(project, "dirty")) {
                _ = t.Start();
                project.ProjectInformation.Name = "modified";
                _ = t.Commit();
            }
            var (fallback, fallbackError) = project.ReadFamilyLabels(name => name == family.Name);
            Assert.That(fallbackError, Is.Null, fallbackError?.ToString());
            Assert.That(fallback!.Version, Is.Null, "a modified document reads per family");
            Assert.That(fallback.Diagnostics.Single(), Does.Contain("unsaved changes"));
            Assert.That(Project(fallback.Families.Single().Labels), Is.EqualTo(Project(perFamily!)));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(project);
            try { Directory.Delete(directory, true); } catch (IOException) { }
        }
    }

    private static IEnumerable<string> Project(IEnumerable<RfaLabel> labels) =>
        labels.Select(l => $"{l.Id} {l.Container} {l.Visibility?.Name} " +
                           string.Join(" | ", l.Segments.Select(s => $"{s.Param.Kind}:{s.Param.Id}:{s.Param.Name}:{s.Param.SharedGuid}:{s.Prefix}:{s.Suffix}:{s.Sample}:{s.LineBreak}")));

    [Test]
    public void Builtin_aliases_come_from_the_enum_in_ordinal_order() {
        var names = FamilyLabels.BuiltInParameterNames((long)BuiltInParameter.ALL_MODEL_TYPE_MARK);

        Assert.That(names, Does.Contain(nameof(BuiltInParameter.ALL_MODEL_TYPE_MARK)));
        Assert.That(names, Is.Ordered.Using((IComparer<string>)StringComparer.Ordinal));
        Assert.That(names.Select(n => Enum.Parse(typeof(BuiltInParameter), n)), Is.All.EqualTo(BuiltInParameter.ALL_MODEL_TYPE_MARK));
        TestContext.Progress.WriteLine($"[PE_RFA_BIP_ALIASES] {(long)BuiltInParameter.ALL_MODEL_TYPE_MARK}: {string.Join(", ", names)}");
    }
}
