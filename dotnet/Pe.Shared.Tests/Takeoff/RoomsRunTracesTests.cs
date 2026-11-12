using Newtonsoft.Json.Linq;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public class RoomsRunTracesTests
{
    // Mutant: Folder returns Path.Combine(root, runId). The ':' then makes the write throw on Windows.
    [Test]
    public void A_T3_shaped_run_id_round_trips_through_its_trace_folder()
    {
        const string runId = "thread:delegated-task:command%3Amcp%3Afoo";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try {
            RoomsRunTraces.Write(root, runId, "zone.json", new JObject { ["label"] = "Z1" });
            var folder = RoomsRunTraces.Folder(root, runId);
            Assert.That(Path.GetFileName(folder), Does.Match("^[0-9a-f]{64}$"));
            Assert.That(Directory.GetDirectories(root), Is.EqualTo(new[] { folder }));
            Assert.That(RoomsRunTraces.RunId(File.ReadAllText(Path.Combine(folder, "zone.json"))), Is.EqualTo(runId));
        } finally {
            Directory.Delete(root, true);
        }
    }
}
