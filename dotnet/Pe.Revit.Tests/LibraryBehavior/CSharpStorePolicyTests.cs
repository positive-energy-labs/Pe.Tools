using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

[TestFixture]
public class CSharpStorePolicyTests {
    [Test]
    public void Unreadable_colors_are_kept_and_geometry_is_discarded() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-policy-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try {
            var colors = Path.Combine(folder, "colors.json");
            File.WriteAllText(colors, "bad");
            Assert.That(DocumentColorLedger.ReadData(colors), Is.Null);
            Assert.That(File.ReadAllText(colors), Is.EqualTo("bad"));
            var pack = Path.Combine(folder, "geometry.pack");
            File.WriteAllText(pack, "bad");
            using (var store = new LinkedGeometryStore(folder).Open()) {
                Assert.That(File.Exists(pack), Is.False);
                var captured = new LinkedGeometryStore.Geometry([], []);
                Assert.That(store.Read("test", () => captured), Is.SameAs(captured));
            }
        } finally { Directory.Delete(folder, true); }
    }

    [Test]
    public void Unreadable_family_snapshot_is_discarded(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var path = FamilySnapshotStore.ResolveStorePath(document);
        try {
            File.WriteAllText(path, "{\"SchemaVersion\":99}");
            FamilySnapshotStore.WarmStart(document);
            Assert.That(File.Exists(path), Is.False);
        } finally {
            if (File.Exists(path)) File.Delete(path);
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
