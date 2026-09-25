using NUnit.Framework;
using Pe.Revit.Partition;

namespace Pe.Partition.Tests;

// Throwaway diagnostic: replays one zone's solve from a level capture (knee, header) with the zone loops
// Rooms.Partition dumped on failure. PE_ROOMS_ZONE_DUMP = the dump json, PE_ROOMS_LEVEL_INPUT = a captured
// PartitionInput of the same level; skipped otherwise. Probes throw a marker: reaching a probe means every
// overlay before Shape() survived.
public sealed class ZoneOverlayReplayTests
{
    private sealed record Dump(double[][] ZoneLoops, List<RoomProposal> Proposals);
    private sealed class ProbeReached : Exception;

    [Test]
    public void Zone_solve_survives_every_overlay_before_probes()
    {
        var dumpPath = Environment.GetEnvironmentVariable("PE_ROOMS_ZONE_DUMP");
        var levelPath = Environment.GetEnvironmentVariable("PE_ROOMS_LEVEL_INPUT");
        if (string.IsNullOrEmpty(dumpPath) || string.IsNullOrEmpty(levelPath)) Assert.Ignore("dump env vars not set");
        var dump = Newtonsoft.Json.JsonConvert.DeserializeObject<Dump>(File.ReadAllText(dumpPath))!;
        var level = Newtonsoft.Json.JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(levelPath))!;
        var input = level with { ZoneLoops = dump.ZoneLoops, Proposals = dump.Proposals };
        TestContext.Out.WriteLine($"knee pieces={input.Knee.Elements.Sum(e => e.Pieces.Count)} zone area={Solve.GeometryOf(dump.ZoneLoops).Area:F1}");
        try
        {
            var answer = Solve.Run(input, (_, _) => throw new ProbeReached());
            TestContext.Out.WriteLine($"no probe needed: rooms={answer.Rooms.Count} hold={answer.Hold}");
        }
        catch (ProbeReached) { TestContext.Out.WriteLine("reached probes: overlays survived"); }
    }
}
