using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

[TestFixture]
public class CSharpStorePolicyTests {
    [Test]
    public void Torn_geometry_tail_keeps_the_complete_prefix() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-pack-" + Guid.NewGuid().ToString("N"));
        try {
            using (var store = new LinkedGeometryStore(folder)) store.Read("first", () => new([], []));
            var path = Path.Combine(folder, "geometry.pack");
            var prefix = new FileInfo(path).Length;
            using (var store = new LinkedGeometryStore(folder)) store.Read("torn", () => new([], []));
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Write)) stream.SetLength(stream.Length - 4);
            using (var store = new LinkedGeometryStore(folder).Open()) {
                Assert.That(File.Exists(path), Is.True, "A torn tail is not a corrupt header");
                Assert.That(new FileInfo(path).Length, Is.EqualTo(prefix));
                store.Read("first", () => throw new AssertionException("The complete prefix must stay cached"));
                var captured = new LinkedGeometryStore.Geometry([], []);
                Assert.That(store.Read("torn", () => captured), Is.SameAs(captured));
            }
        } finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }

    [Test]
    public void Geometry_checksum_miss_evicts_only_that_entry() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-pack-" + Guid.NewGuid().ToString("N"));
        try {
            using (var store = new LinkedGeometryStore(folder).Open()) {
                store.Read("bad", () => new([], []));
                store.Read("good", () => new([], []));
            }
            var path = Path.Combine(folder, "geometry.pack");
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Write)) {
                stream.Position = 8 + 32 + 4; // First record checksum, after the pack header, key and length.
                stream.WriteByte(0xFF);
            }
            using (var store = new LinkedGeometryStore(folder).Open()) {
                var captured = new LinkedGeometryStore.Geometry([], []);
                Assert.That(store.Read("bad", () => captured), Is.SameAs(captured));
                store.Read("good", () => throw new AssertionException("An unrelated entry must stay cached"));
            }
        } finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }

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
