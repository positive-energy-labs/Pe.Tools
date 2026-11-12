using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;
using System.Text;

namespace Pe.Shared.Tests.Storage;

[TestFixture]
public class PodRunAtomicTests {
    [Test]
    public void Starting_a_run_sweeps_only_stale_temporary_files_from_listed_run_folders() {
        var pod = "sweep-proof-" + Guid.NewGuid().ToString("N");
        var first = PodRuns.NewRunFolder(pod);
        var root = Path.GetDirectoryName(first)!;
        try {
            Directory.CreateDirectory(Path.Combine(first, "source"));
            var stale = Path.Combine(first, "source", "input.json.abandoned.tmp");
            var active = Path.Combine(first, "active.tmp");
            var published = Path.Combine(first, "input.json");
            File.WriteAllText(stale, "partial");
            File.WriteAllText(active, "in progress");
            File.WriteAllText(published, "published");
            var now = DateTime.UtcNow;
            File.SetLastWriteTimeUtc(stale, now.AddHours(-2));
            File.SetLastWriteTimeUtc(active, now.AddSeconds(-10));
            PodRuns.NewRunFolder(pod);
            Assert.Multiple(() => {
                Assert.That(File.Exists(stale), Is.False);
                Assert.That(File.Exists(active), Is.True, "Another process may still be publishing this recent temporary file");
                if (File.Exists(active)) Assert.That(File.ReadAllText(active), Is.EqualTo("in progress"));
                Assert.That(File.ReadAllText(published), Is.EqualTo("published"));
            });
        } finally { Directory.Delete(root, true); }
    }

    [Test]
    public void Receipt_is_create_only_and_duplicate_preserves_first_bytes() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-run-" + Guid.NewGuid().ToString("N"));
        try {
            var receipt = PodReceipt.ForOperation(null, "fixture", null, PodRunOutcome.Succeeded, [], null);
            var path = PodRuns.WriteReceiptIn(folder, receipt, []);
            var before = File.ReadAllBytes(path);
            Assert.Throws<IOException>(() => PodRuns.WriteReceiptIn(folder, receipt, []));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(before));
            Assert.That(Directory.GetFiles(folder), Is.EqualTo(new[] { path }));
        } finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }

    [Test]
    public void Input_collision_preserves_existing_file_and_removes_only_new_files() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-input-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try {
            File.WriteAllText(Path.Combine(folder, "input.json"), "existing");
            Assert.Throws<IOException>(() => PodRuns.WriteInputIn(folder, new { test = true }, [
                new PodRunInputFile("effective", null, "data.json", "data.json", Encoding.UTF8.GetBytes("{}"))
            ]));
            Assert.That(File.ReadAllText(Path.Combine(folder, "input.json")), Is.EqualTo("existing"));
            Assert.That(Directory.GetFiles(folder).Select(Path.GetFileName), Is.EqualTo(new[] { "input.json" }));
        } finally { Directory.Delete(folder, true); }
    }
}
