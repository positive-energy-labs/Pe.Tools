using Newtonsoft.Json.Linq;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public class RoomsRunTracesTests
{
    [TestCase(true)]
    [TestCase(false)]
    public void AnInterruptedPartitionLeavesTheEarlierRunInThePlan(bool cancelled)
    {
        const string first = "first.json", second = "second.json";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try
        {
            using var published = new RoomsRunTraces.Pending(root, "published");
            published.Write(first, new JObject());
            published.Write(second, new JObject());
            published.Publish();
            foreach (var name in new[] { first, second })
                File.SetLastWriteTimeUtc(Path.Combine(RoomsRunTraces.Folder(root, "published"), name), DateTime.UtcNow.AddMinutes(-1));

            using var stop = new CancellationTokenSource();
            Assert.Throws(cancelled ? typeof(OperationCanceledException) : typeof(InvalidOperationException), () =>
            {
                using var pending = new RoomsRunTraces.Pending(root, "interrupted");
                Rooms.SolveZones(new[] { first, second }, name =>
                {
                    if (name == second) throw new InvalidOperationException("Second zone failed");
                    pending.Write(name, new JObject());
                    Assert.That(RoomsRunTraces.Find(root, null, new[] { first, second }).Count, Is.EqualTo(2));
                    if (cancelled) stop.Cancel();
                }, stop.Token);
            });

            var traces = RoomsRunTraces.Find(root, null, new[] { first, second });
            Assert.That(traces.Select(f => RoomsRunTraces.RunId(File.ReadAllText(f.FullName))),
                Is.EqualTo(new[] { "published", "published" }));
            Assert.That(RoomsRunTraces.Find(root, "interrupted", new[] { first, second }), Is.Empty);
            Assert.That(Directory.EnumerateFiles(root, "*.json", SearchOption.AllDirectories).Count(), Is.EqualTo(2));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    // Mutant: Folder returns Path.Combine(root, runId). The ':' then makes the write throw on Windows.
    [Test]
    public void A_T3_shaped_run_id_round_trips_through_its_trace_folder()
    {
        const string runId = "thread:delegated-task:command%3Amcp%3Afoo";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try {
            using var pending = new RoomsRunTraces.Pending(root, runId);
            pending.Write("zone.json", new JObject { ["label"] = "Z1" });
            Assert.That(RoomsRunTraces.Find(root, runId, new[] { "zone.json" }), Is.Empty);
            pending.Publish();
            var folder = RoomsRunTraces.Folder(root, runId);
            Assert.That(Path.GetFileName(folder), Does.Match("^[0-9a-f]{64}$"));
            Assert.That(Directory.GetDirectories(root), Is.EqualTo(new[] { folder }));
            Assert.That(RoomsRunTraces.Find(root, runId, new[] { "zone.json" }).Count, Is.EqualTo(1));
            Assert.That(RoomsRunTraces.RunId(File.ReadAllText(Path.Combine(folder, "zone.json"))), Is.EqualTo(runId));
        } finally {
            Directory.Delete(root, true);
        }
    }
}
