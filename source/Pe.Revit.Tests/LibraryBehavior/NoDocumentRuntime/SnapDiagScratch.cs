using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// TEMPORARY diagnostic scratch for phase-3 snap bring-up. Delete before final commit.
public sealed class SnapDiagScratch
{
    [Test]
    public void Dump_estate_snap_log()
    {
        var mi = typeof(TakeoffReplayTests).GetMethod("BuildSyntheticEstate",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
        var snap = (DetectSnapshot)mi.Invoke(null, null)!;
        var opt = new TakeoffOptions {
            CellFt = 0.5, Formulation = TakeoffFormulation.Partition, SealWallRunGaps = true,
        };
        var lines = new List<string>();
        var run = snap.Replay(opt, lines.Add);
        foreach (var r in run.Rooms)
            lines.Add($"{r.Id} sqft={r.RawSqft:F1} verts={r.Polygon.Count} poly=" +
                string.Join(" ", r.Polygon.Select(v => $"({v[0]:F1},{v[1]:F1})")));
        File.WriteAllLines(
            @"C:\Users\kaitp\AppData\Local\Temp\claude\C--Users-kaitp-source-repos-Pe-Tools\b681b2ca-bc2f-4385-8fd9-b16b70f21624\scratchpad\estate-snap-log.txt",
            lines);
    }
}
