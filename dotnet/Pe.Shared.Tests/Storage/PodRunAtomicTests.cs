using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;
using System.Text;

namespace Pe.Shared.Tests.Storage;

[TestFixture]
public class PodRunAtomicTests {
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
