using NUnit.Framework;

using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// TEMPORARY (experiment R2d): census of door-head seal connected components per level, to pick
// an empirical door-width bound. Delete before any commit.
public sealed class R2dDoorHeadCensusTests
{
    private static readonly (string View, string Token)[] Levels = {
        ("Lower Level", "Level_0_Lower_Level"),
        ("Main Level", "Level_1_Main_Level"),
        ("Upper Level", "Level_2_Upper_Level"),
        ("Attic Level", "Level_3_Attic"),
    };

    private static string? FindReplayBin(string token) =>
        new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .Select(dir => Path.Combine(dir, $"replay_{token}.bin"))
            .FirstOrDefault(File.Exists);

    [Test]
    [Explicit("R2d experiment instrumentation")]
    public void Door_head_component_census()
    {
        foreach (var (view, token) in Levels)
        {
            string? bin = FindReplayBin(token);
            if (bin == null) { TestContext.Out.WriteLine($"{view}: no replay bin"); continue; }
            var snap = DetectSnapshot.Load(bin);
            var profile = TakeoffPolicy.InferLevelProfile(snap);
            if (!profile.Options.SealDoorHeads)
            {
                TestContext.Out.WriteLine($"{view}: SealDoorHeads=false");
                continue;
            }
            var seals = TakeoffPolicy.SealClasses(snap, profile);
            int W = snap.Field.W, H = snap.Field.H;
            double cellFt = snap.Field.CellFt, cellSf = cellFt * cellFt;
            var comp = new int[W * H];
            var comps = new List<(int Cells, int MinX, int MinY, int MaxX, int MaxY)>();
            for (int i = 0; i < W * H; i++)
            {
                if (seals[i] != Detector.SealDoorHead || comp[i] != 0) continue;
                int id = comps.Count + 1;
                int cells = 0, minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
                var stack = new Stack<int>();
                stack.Push(i);
                comp[i] = id;
                while (stack.Count > 0)
                {
                    int c = stack.Pop();
                    int cx = c % W, cy = c / W;
                    cells++;
                    minX = Math.Min(minX, cx); minY = Math.Min(minY, cy);
                    maxX = Math.Max(maxX, cx); maxY = Math.Max(maxY, cy);
                    for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        int nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                        int ni = ny * W + nx;
                        if (seals[ni] == Detector.SealDoorHead && comp[ni] == 0)
                        {
                            comp[ni] = id;
                            stack.Push(ni);
                        }
                    }
                }
                comps.Add((cells, minX, minY, maxX, maxY));
            }
            TestContext.Out.WriteLine(
                $"{view}: {comps.Count} door-head components, {comps.Sum(c => c.Cells) * cellSf:F0} sf total");
            foreach (var c in comps.OrderByDescending(c => c.Cells))
            {
                double bw = (c.MaxX - c.MinX + 1) * cellFt, bh = (c.MaxY - c.MinY + 1) * cellFt;
                TestContext.Out.WriteLine(
                    $"  {c.Cells * cellSf,8:F1} sf  bbox {bw,6:F2} x {bh,6:F2} ft  maxDim {Math.Max(bw, bh),6:F2} ft");
            }
        }
    }
}
