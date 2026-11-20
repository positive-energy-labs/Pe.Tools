using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Takeoff.Tests;

public sealed class RoomsPartitionCancellationTests
{
    [TestCase(true)]
    [TestCase(false)]
    public void A_refused_record_stops_before_the_mutation_boundary(bool overCap)
    {
        var record = new RoomsRegionRecord();
        record.Regions["room"] = new(TakeoffCarriers.RoleRoomRegion,
            new RoomFields(Name: overCap ? new string('x', OwnerBlob.MaxBytes) : "Office"),
            RegionProvenance.Default with { RunId = overCap ? "drawn" : "" });
        bool mutated = false;

        var error = Assert.Throws<InvalidOperationException>(() => record.BeforeMutation(() => mutated = true));

        Assert.That(error!.Message, Does.Contain(overCap ? "the cap is" : "Invalid Rooms row"));
        Assert.That(mutated, Is.False);
    }

    [TestCase(nameof(Rooms.Partition))]
    [TestCase(nameof(Rooms.Draw))]
    [TestCase(nameof(Rooms.Merge))]
    public void Mutation_entry_point_calls_the_record_capacity_gate(string entryPoint)
    {
        using var assembly = new PEReader(File.OpenRead(typeof(Rooms).Assembly.Location));
        var metadata = assembly.GetMetadataReader();
        MethodDefinition Method(string type, string name) => metadata.TypeDefinitions
            .Select(metadata.GetTypeDefinition)
            .Single(value => metadata.GetString(value.Namespace) == typeof(Rooms).Namespace
                && metadata.GetString(value.Name) == type)
            .GetMethods().Select(metadata.GetMethodDefinition)
            .Single(value => metadata.GetString(value.Name) == name);
        var gate = Method(nameof(RoomsRegionRecord), nameof(RoomsRegionRecord.BeforeMutation));
        var entry = Method(nameof(Rooms), entryPoint);
        var il = assembly.GetMethodBody(entry.RelativeVirtualAddress).GetILBytes()!;
        bool callsGate = Enumerable.Range(0, il.Length - 4).Any(index =>
        {
            if (il[index] != OpCodes.Call.Value && il[index] != OpCodes.Callvirt.Value) return false;
            var token = BitConverter.ToInt32(il, index + 1);
            if ((token >>> 24) != 0x2b || (token & 0xffffff) > metadata.GetTableRowCount(TableIndex.MethodSpec)
                || (token & 0xffffff) == 0) return false;
            var called = metadata.GetMethodSpecification((MethodSpecificationHandle)MetadataTokens.EntityHandle(token)).Method;
            return called.Kind == HandleKind.MethodDefinition
                && metadata.GetMethodDefinition((MethodDefinitionHandle)called).RelativeVirtualAddress == gate.RelativeVirtualAddress;
        });
        Assert.That(callsGate, Is.True);
    }

    [Test]
    public void Pending_creation_counts_toward_the_same_limit_as_live_rows()
    {
        var record = new RoomsRegionRecord();
        var row = new RegionRow(TakeoffCarriers.RoleRoomRegion, new RoomFields(Name: new string('x', 140_000)),
            RegionProvenance.Default);
        record.Regions["live-room"] = row;
        Assert.That(record.BeforeMutation(() => true), Is.True);
        Assert.That(() => record.BeforeMutation<bool>(() => throw new AssertionException("Mutation ran"), [row]),
            Throws.InvalidOperationException.With.Message.Contains("the cap is"));
        Assert.That(record.Regions.Keys, Is.EqualTo(new[] { "live-room" }));
    }

    [Test]
    public void A_reused_numeric_target_must_match_the_captured_unique_id()
    {
        Assert.DoesNotThrow(() => TakeoffAtlas.RequireRegionIdentity(42, "captured", "captured"));
        Assert.That(() => TakeoffAtlas.RequireRegionIdentity(42, "captured", "reused"),
            Throws.InvalidOperationException.With.Message.Contains("42").And.Message.Contains("captured"));
    }

    [Test]
    public void Pruning_releases_deleted_region_rows_and_retains_their_merge_ancestry()
    {
        var record = new RoomsRegionRecord();
        record.Regions["deleted"] = new(TakeoffCarriers.RoleRoomRegion,
            new RoomFields(Name: new string('x', OwnerBlob.MaxBytes)), RegionProvenance.Default);
        record.Regions["merged"] = new(TakeoffCarriers.RoleRoomRegion, new(),
            RegionProvenance.Default with { MergedFrom = ["deleted"] });

        record.Prune(id => id == "merged");

        var stored = record.BeforeMutation(() => OwnerBlob.Encode(RoomsRegionRecord.Owner, record.ToData()));
        var read = RoomsRegionRecord.Decode(OwnerBlob.Decode(RoomsRegionRecord.Owner, stored)).OrThrow()!;
        Assert.That(read.Regions.Keys, Is.EqualTo(new[] { "merged" }));
        Assert.That(read["merged"]!.Provenance.MergedFrom, Is.EqualTo(new[] { "deleted" }));
    }

    [TestCase(1, OwnerBlobStatus.Invalid, "regions map")]
    [TestCase(99, OwnerBlobStatus.UnknownVersion, "version")]
    public void An_unreadable_record_requires_its_current_preview_before_partition_can_stage(
        int version, OwnerBlobStatus status, string reason)
    {
        var owner = RoomsRegionRecord.Owner;
        var raw = $$$"""{"owner":"{{{owner.Owner}}}","version":{{{version}}},"data":{}}""";
        var stored = OwnerBlob.Decode(owner, raw);
        Assert.That(stored.Status, Is.EqualTo(status));
        var evidence = stored.Replacement!;
        Assert.That(evidence.Reason, Does.Contain(reason));

        Assert.That(() => RoomsRegionRecord.Stage(stored, null),
            Throws.InvalidOperationException.With.Message.Contains("Preview before").And.Message.Contains(reason));
        var changed = OwnerBlob.Decode(owner, raw + " ");
        Assert.That(() => RoomsRegionRecord.Stage(changed, evidence),
            Throws.InvalidOperationException.With.Message.Contains("changed since replacement was planned"));

        var record = RoomsRegionRecord.Stage(stored, evidence);
        Assert.That(record.Regions, Is.Empty);
        Assert.That(record.Refusal, Is.EqualTo(evidence.Reason));
        var kept = new List<string>();
        var updated = OwnerBlob.Replace(stored, record.ToData(), (_, bytes) => kept.Add(bytes), evidence);
        Assert.That(kept, Is.EqualTo(new[] { raw }));
        Assert.That(OwnerBlob.Decode(owner, updated).Replacement, Is.Null);
    }

    [TestCase(1)]
    [TestCase(2)]
    public void AStopDuringSolveLeavesTheRemainingWorkUnstarted(int stopAt)
    {
        using var stop = new CancellationTokenSource();
        int[] zones = [1, 2];
        var visited = new List<int>();

        Assert.Throws<OperationCanceledException>(() => Rooms.SolveZones(zones, zone =>
        {
            visited.Add(zone);
            if (zone == stopAt) stop.Cancel();
        }, stop.Token));

        Assert.That(visited, Is.EqualTo(zones.Take(stopAt)));
    }
}
