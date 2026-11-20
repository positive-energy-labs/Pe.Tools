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
    public void An_original_with_a_lone_surrogate_refuses_without_writing()
    {
        var root = Directory.CreateTempSubdirectory("pe-rooms-original-encoding-");
        try
        {
            var text = "{\"reason\":\"" + (char)0xd800 + "\"}";
            Assert.Throws<System.Text.EncoderFallbackException>(() => RoomsRunTraces.KeepOriginal(root.FullName, "doc", text));
            Assert.That(root.EnumerateFileSystemInfos(), Is.Empty);
        }
        finally { root.Delete(true); }
    }

    [Test]
    public void A_zero_zone_attempt_does_not_replace_the_view_run()
    {
        var record = new RoomsRegionRecord();
        var completed = new RoomsTraceRun("view", "committed", Guid.NewGuid().ToString("N"), 1);
        var failed = completed with { RunId = "failed", Zones = 0 };
        Assert.That(record.RecordSolvedRun(failed), Is.False);
        Assert.That(record.Runs, Is.Empty);
        Assert.That(record.RecordSolvedRun(completed), Is.True);
        Assert.That(record.RecordSolvedRun(failed), Is.False);
        Assert.That(record.Runs[completed.View], Is.EqualTo(completed));
    }

    [Test]
    public void An_original_is_exact_create_only_and_namespaced_by_document()
    {
        var root = Directory.CreateTempSubdirectory("pe-rooms-originals-").FullName;
        try
        {
            var original = new Pe.Revit.Partition.Room(4, Pe.Revit.Partition.Disposition.Held, "no-floor",
                [0, 0, 10.123456789, 0, 0, 10, 0, 0], 50, 2, 2, 1, null, null, []);
            var digest = RoomsRunTraces.KeepOriginal(root, "document-a", TakeoffJson.Serialize(original));
            Assert.That(RoomsRunTraces.KeepOriginal(root, "document-a", TakeoffJson.Serialize(original)), Is.EqualTo(digest));
            Assert.That(Directory.GetFiles(root, "*.json", SearchOption.AllDirectories), Has.Length.EqualTo(1));
            Assert.That(RoomsRunTraces.ReadOriginal(root, "document-b", digest), Is.Null);
            var readback = RoomsRunTraces.ReadOriginal(root, "document-a", digest);
            Assert.That(TakeoffJson.Serialize(readback!), Is.EqualTo(TakeoffJson.Serialize(original)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Test]
    public void Missing_and_damaged_originals_are_visible_and_a_later_save_repairs_the_digest()
    {
        var root = Directory.CreateTempSubdirectory("pe-rooms-damaged-original-").FullName;
        try
        {
            var record = new RoomsRegionRecord();
            var original = new Pe.Revit.Partition.Room(4, Pe.Revit.Partition.Disposition.Void, "no-floor",
                [0, 0, 10, 0, 0, 10, 0, 0], 50, 2, 2, 1, null, null, []);
            var json = TakeoffJson.Serialize(original);
            var digest = RoomsRunTraces.Hash(json);
            var provenance = RegionProvenance.Default with { OriginalTrace = digest };
            Assert.That(record.ProjectOriginal(RegionProvenance.Default, root).OriginalUnavailable, Is.False);
            Assert.That(record.ProjectOriginal(provenance, root).OriginalUnavailable, Is.True);

            RoomsRunTraces.KeepOriginal(root, record.TraceId, json);
            var path = Directory.GetFiles(root, "*.json", SearchOption.AllDirectories).Single();
            const string damaged = "damaged evidence";
            File.WriteAllText(path, damaged);
            Assert.That(record.ProjectOriginal(provenance, root).OriginalUnavailable, Is.True);
            RoomsRunTraces.KeepOriginal(root, record.TraceId, json);

            Assert.That(record.ProjectOriginal(provenance, root).Partition?.Disposition,
                Is.EqualTo(Pe.Revit.Partition.Disposition.Void));
            Assert.That(File.ReadAllText(Directory.GetFiles(Path.GetDirectoryName(path)!, "*.damaged-*").Single()),
                Is.EqualTo(damaged));
        }
        finally { Directory.Delete(root, true); }
    }

    [Test]
    public void A_committed_reference_recovers_failed_promotion_and_repeated_reads()
    {
        const string view = "view-a", zone = "zone-00000042";
        const string runId = "thread:delegated-task:command%3Amcp%3Afoo";
        var root = Directory.CreateTempSubdirectory("pe-rooms-runs-").FullName;
        try
        {
            var record = new RoomsRegionRecord();
            var doc = record.TraceId;
            var folder = RoomsRunTraces.Folder(root, doc, view, runId);
            string destination;
            using (var pending = new RoomsRunTraces.Pending(root, doc, view, runId))
            {
                pending.Write(zone, new JObject { ["label"] = "Z1" });
                record.Regions[zone] = new(TakeoffRecords.RoleZoningRegion, new(), RegionProvenance.Default);
                record.Runs[view] = pending.Reference;
                destination = Path.Combine(folder, pending.Reference.Attempt);
                File.WriteAllText(destination, "obstruct promotion");
                pending.MarkCommitted();
                Assert.That(pending.Publish, Throws.InstanceOf<IOException>());
            }
            File.Delete(destination);
            Assert.That(Path.GetFileName(folder), Does.Match("^[0-9a-f]{64}$"));
            var stored = OwnerBlob.Encode(RoomsRegionRecord.Owner, record.ToData());
            var modelPath = Path.Combine(root, "unsaved-model");
            var renamedPath = Path.Combine(root, "renamed.rvt");
            File.WriteAllText(modelPath, stored);
            File.Move(modelPath, renamedPath);

            var reopened = RoomsRegionRecord.Decode(OwnerBlob.Decode(RoomsRegionRecord.Owner, File.ReadAllText(renamedPath))).OrThrow()!;
            Assert.That(reopened.TraceId, Is.EqualTo(doc));
            reopened.Prune(_ => false);
            var pruned = RoomsRegionRecord.Decode(OwnerBlob.Decode(RoomsRegionRecord.Owner,
                OwnerBlob.Encode(RoomsRegionRecord.Owner, reopened.ToData()))).OrThrow()!;
            Assert.That(pruned.Regions, Is.Empty, "The first zone was deleted");
            var committed = pruned.Runs[view];
            Assert.That(committed, Is.Not.Null);
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, null), Is.Empty);
            Assert.That(RoomsRunTraces.Find(root, "another project", view, runId, committed), Is.Empty);
            var recovered = RoomsRunTraces.Find(root, reopened.TraceId, view, runId, committed).Single();
            Assert.That((string?)JObject.Parse(File.ReadAllText(recovered.FullName))["runId"], Is.EqualTo(runId));
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, committed).Single().FullName, Is.EqualTo(recovered.FullName));
            using var stale = new RoomsRunTraces.Pending(root, doc, view, "older-run");
            stale.Write(zone, new JObject());
            stale.MarkCommitted();
            stale.Publish();
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, null), Is.Empty);
            Assert.That(RoomsRunTraces.Find(root, doc, view, "older-run", committed), Is.Empty);
            File.Delete(recovered.FullName);
            Assert.That(RoomsRunTraces.Find(root, doc, view, runId, committed), Is.Empty);
        }
        finally { Directory.Delete(root, true); }
    }
}
