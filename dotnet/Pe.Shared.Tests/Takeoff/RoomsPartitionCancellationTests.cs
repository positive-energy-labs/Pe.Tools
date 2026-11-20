using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class RoomsPartitionCancellationTests
{
    [Test]
    public void PartitionBindsMissingCarriersInsideItsOwnTransaction()
    {
        var root = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "Pe.Tools.slnx"))) root = root.Parent;
        Assert.That(root, Is.Not.Null, "Pe.Tools.slnx not found above the test directory");
        // This boundary is tested from source because the deterministic rung cannot create a Revit Document.
        var source = File.ReadAllText(Path.Combine(root!.FullName, "dotnet", "Pe.Revit.Takeoff", "Rooms.cs"));
        var partition = source[source.IndexOf("public static RoomsPartitionResult Partition(", StringComparison.Ordinal)
            ..source.IndexOf("internal static void SolveZones", StringComparison.Ordinal)];
        Assert.That(partition, Does.Not.Contain("TakeoffCarriers.Require("));
        var transaction = partition.IndexOf("DocumentSandbox.BeginCommit(", StringComparison.Ordinal);
        var bind = partition.IndexOf("TakeoffCarriers.InitializeNext(", StringComparison.Ordinal);
        var commit = partition.IndexOf("transaction.Complete()", StringComparison.Ordinal);
        Assert.That(transaction, Is.GreaterThanOrEqualTo(0));
        Assert.That(bind, Is.GreaterThan(transaction));
        Assert.That(commit, Is.GreaterThan(bind));
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
