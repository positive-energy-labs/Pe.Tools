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
