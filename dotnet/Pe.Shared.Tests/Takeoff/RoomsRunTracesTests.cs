using Newtonsoft.Json.Linq;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Takeoff.Tests;

public class RoomsRunTracesTests
{
    [TestCase(true)]
    [TestCase(false)]
    public void AnInterruptedPartitionLeavesTheEarlierRunInThePlan(bool cancelled)
    {
        const string doc = "project-a", view = "view-a", zone = "zone-00000042";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try
        {
            using var published = new RoomsRunTraces.Pending(root, doc, view, "published");
            published.Write(zone, new JObject());
            published.MarkCommitted();
            published.Publish();

            using var stop = new CancellationTokenSource();
            Assert.Throws(cancelled ? typeof(OperationCanceledException) : typeof(InvalidOperationException), () =>
            {
                using var pending = new RoomsRunTraces.Pending(root, doc, view, "interrupted");
                Rooms.SolveZones(new[] { zone, "second" }, name =>
                {
                    if (name != zone) throw new InvalidOperationException("Second zone failed");
                    pending.Write(name, new JObject());
                    Assert.That(RoomsRunTraces.Find(root, doc, view, "interrupted", null), Is.Empty);
                    if (cancelled) stop.Cancel();
                }, stop.Token);
            });

            Assert.That(RoomsRunTraces.Find(root, doc, view, "published", published.Reference), Has.Count.EqualTo(1));
            Assert.That(RoomsRunTraces.Find(root, doc, view, "interrupted", null), Is.Empty);
            Assert.That(Directory.EnumerateFiles(root, "*.json", SearchOption.AllDirectories).Count(), Is.EqualTo(1));
        }
        finally { Directory.Delete(root, true); }
    }

    [Test]
    public void An_original_is_exact_create_only_and_namespaced_by_document()
    {
        var root = Directory.CreateTempSubdirectory("pe-rooms-originals-").FullName;
        try
        {
            var original = new Pe.Revit.Partition.Room(4, Pe.Revit.Partition.Disposition.Held, "no-floor",
                [0, 0, 10.123456789, 0, 0, 10, 0, 0], 50, 2, 2, 1, null, null, []);
            var digest = RoomsRunTraces.KeepOriginal(root, "document-a", original);
            Assert.That(RoomsRunTraces.KeepOriginal(root, "document-a", original), Is.EqualTo(digest));
            Assert.That(Directory.GetFiles(root, "*.json", SearchOption.AllDirectories), Has.Length.EqualTo(1));
            Assert.That(RoomsRunTraces.ReadOriginal(root, "document-b", digest), Is.Null);
            var readback = RoomsRunTraces.ReadOriginal(root, "document-a", digest);
            Assert.That(TakeoffJson.Serialize(readback!), Is.EqualTo(TakeoffJson.Serialize(original)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Test]
    public void A_committed_reference_recovers_failed_promotion_and_repeated_reads()
    {
        const string doc = "project:a", view = "view-a", zone = "zone-00000042";
        const string runId = "thread:delegated-task:command%3Amcp%3Afoo";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try
        {
            var record = new RoomsRegionRecord();
            var folder = RoomsRunTraces.Folder(root, doc, view, runId);
            string destination;
            using (var pending = new RoomsRunTraces.Pending(root, doc, view, runId))
            {
                pending.Write(zone, new JObject { ["label"] = "Z1" });
                record.Regions[zone] = new(TakeoffCarriers.RoleZoningRegion, new(),
                    RegionProvenance.Default with { TraceRun = pending.Reference });
                destination = Path.Combine(folder, pending.Reference.Attempt);
                File.WriteAllText(destination, "obstruct promotion");
                pending.MarkCommitted();
                Assert.That(pending.Publish, Throws.InstanceOf<IOException>());
            }
            File.Delete(destination);
            Assert.That(Path.GetFileName(folder), Does.Match("^[0-9a-f]{64}$"));
            var stored = OwnerBlob.Encode(RoomsRegionRecord.Owner, record.ToData());
            var committed = RoomsRegionRecord.Decode(OwnerBlob.Decode(RoomsRegionRecord.Owner, stored)).Value![zone]!.Provenance.TraceRun;
            Assert.That(committed, Is.Not.Null);
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, null), Is.Empty);
            Assert.That(RoomsRunTraces.Find(root, "another project", view, runId, committed), Is.Empty);
            var recovered = RoomsRunTraces.Find(root, doc, view, runId, committed).Single();
            Assert.That((string?)JObject.Parse(File.ReadAllText(recovered.FullName))["runId"], Is.EqualTo(runId));
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, committed).Single().FullName, Is.EqualTo(recovered.FullName));
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, null).Single().FullName, Is.EqualTo(recovered.FullName));
            File.Delete(recovered.FullName);
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, committed), Is.Empty);
        }
        finally { Directory.Delete(root, true); }
    }
}
