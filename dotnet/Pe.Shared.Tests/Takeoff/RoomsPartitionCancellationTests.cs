using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class RoomsPartitionCancellationTests
{
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
