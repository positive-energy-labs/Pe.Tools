using Pe.Revit.Takeoff.Rhvac;

using NUnit.Framework;

namespace Pe.Takeoff.Tests;

// Self-tests for the RHVAC eval scorer against the committed project-a fixture (150 rooms).
// The oracle plays both sides: reconstructing candidates from it must score perfect, and every
// controlled perturbation must surface at exactly the expected path. No files are written.
public sealed class RhvacEvalTests
{
    private static readonly string FixtureDir = FindFixtureDir();
    private static readonly OracleExtract Oracle =
        RhvacEval.LoadOracle(Path.Combine(FixtureDir, "oracle.extract.json"));
    private static readonly ToleranceProfile Bootstrap =
        RhvacEval.LoadTolerances(Path.Combine(FixtureDir, "tolerances.json"), "bootstrap");
    private static readonly ToleranceProfile Standard =
        RhvacEval.LoadTolerances(Path.Combine(FixtureDir, "tolerances.json"), "standard");
    // In-memory, deliberately NOT the committed room-map.json: the fixture map is curated data
    // that evolves (skips shrink the oracle pool), while these self-tests need the full 150-room
    // oracle.
    private static readonly RoomMap EmptyMap = new(new List<RoomMapMatch>(), new List<RoomMapSkip>());

    [Test]
    public void Oracle_reconstructed_candidates_with_full_curated_map_score_perfect()
    {
        var card = RhvacEval.Score(ToCandidates(Oracle), Oracle, FullMap(Oracle), Bootstrap);

        Assert.That(card.Violations, Is.Empty);
        Assert.That(card.Warnings, Is.Empty);
        Assert.That(card.Pass, Is.True);
        Assert.That(card.MatchedCount, Is.EqualTo(Oracle.Rooms.Count));
        Assert.That(card.CoverageAreaPct, Is.EqualTo(100).Within(1e-6));
        Assert.That(card.CoverageCfmPct, Is.EqualTo(100).Within(1e-6));
        Assert.That(card.ProvisionalMatches, Is.Zero);
    }

    [Test]
    public void Provisional_matches_alone_never_pass()
    {
        // A perfect reconstruction with no curated matches: area auto-matching carries no identity
        // evidence, so it must not gate. Coverage (curated) is 0 and the coverage gate fails, while
        // the provisional diagnostic reports the full area.
        var card = RhvacEval.Score(ToCandidates(Oracle), Oracle, EmptyMap, Bootstrap);

        Assert.That(card.Pass, Is.False);
        Assert.That(card.Violations, Has.Count.EqualTo(1));
        Assert.That(card.Violations[0].Path, Is.EqualTo("coverage.areaPct"));
        Assert.That(card.Warnings, Is.Empty);
        Assert.That(card.CoverageAreaPct, Is.Zero);
        Assert.That(card.ProvisionalCoverageAreaPct, Is.EqualTo(100).Within(1e-6));
        Assert.That(card.ProvisionalMatches, Is.EqualTo(card.MatchedCount));
    }

    [Test]
    public void Perturbed_room_area_yields_one_violation_at_its_path()
    {
        var candidates = ToCandidates(Oracle);
        var index = candidates.FindIndex(room => room.Number == 2); // Mech 021, largest room
        var original = candidates[index];
        var perturbed = new RhvacRoom(
            original.Number,
            original.Name,
            original.AreaSquareFeet * 1.2,
            original.CeilingHeightFeet
        );
        perturbed.Floors.AddRange(original.Floors);
        perturbed.Roofs.AddRange(original.Roofs);
        perturbed.Walls.AddRange(original.Walls);
        candidates[index] = perturbed;

        // Full curated map so only the perturbation can breach; the drift would also have escaped
        // bootstrap's 15% auto-match acceptance, so an explicit pin is required either way.
        var card = RhvacEval.Score(candidates, Oracle, FullMap(Oracle), Bootstrap);
        TestContext.Out.WriteLine(card.ToText());

        Assert.That(card.Pass, Is.False);
        Assert.That(card.Violations, Has.Count.EqualTo(1));
        Assert.That(card.Violations[0].Path, Is.EqualTo("rooms[2].areaSquareFeet"));
        Assert.That(card.Violations[0].Pct, Is.EqualTo(20).Within(1e-6));
        Assert.That(card.Violations[0].WeightCfm, Is.GreaterThan(0));
        Assert.That(card.CoverageAreaPct, Is.EqualTo(100).Within(1e-6));
    }

    [Test]
    public void Missing_half_the_candidates_fails_the_coverage_gate()
    {
        // Curate every room that still has a candidate; the coverage gate must fail on the
        // genuinely missing half, not on curation absence.
        var keptRooms = Oracle.Rooms.Where((_, index) => index % 2 == 0).ToList();
        var candidates = ToCandidates(Oracle).Where((_, index) => index % 2 == 0).ToList();
        var map = new RoomMap(
            keptRooms.Select(room => new RoomMapMatch(room.Number, $"R{room.Number}")).ToList(),
            new List<RoomMapSkip>()
        );

        var card = RhvacEval.Score(candidates, Oracle, map, Bootstrap);

        Assert.That(card.Pass, Is.False);
        Assert.That(
            card.Violations,
            Has.One.Matches<RhvacEvalIssue>(issue => issue.Path == "coverage.areaPct")
        );
        Assert.That(card.CoverageAreaPct, Is.LessThan(Bootstrap.CoverageAreaPctMin));
        Assert.That(card.CoverageAreaPct, Is.GreaterThan(0));
        Assert.That(card.UnmatchedOracle, Is.Not.Empty);
        Assert.That(card.MatchedCount, Is.EqualTo(candidates.Count));
    }

    [Test]
    public void Map_skip_shrinks_the_pool_and_explicit_match_overrides_auto_match()
    {
        var candidates = ToCandidates(Oracle);
        var map = new RoomMap(
            new List<RoomMapMatch> { new(64, "R64") },
            new List<RoomMapSkip> { new(1, "Golf Sim not modeled yet") }
        );

        var card = RhvacEval.Score(candidates, Oracle, map, Bootstrap);

        Assert.That(card.OracleCount, Is.EqualTo(Oracle.Rooms.Count - 1));
        // Provisional coverage sees every remaining room; skip left the denominator entirely.
        Assert.That(card.ProvisionalCoverageAreaPct, Is.EqualTo(100).Within(1e-6));
        Assert.That(card.UnmatchedOracle, Is.Empty);
        // Room 1's candidate floats free: its oracle room was skipped and no other is area-compatible.
        Assert.That(card.UnmatchedCandidates, Has.Count.EqualTo(1));
        Assert.That(card.UnmatchedCandidates[0].Number, Is.EqualTo(1));
        // 148 provisional = 149 matched minus the one explicit (non-provisional) pair.
        Assert.That(card.ProvisionalMatches, Is.EqualTo(card.MatchedCount - 1));
        // The single curated match cannot carry the coverage gate; nothing else may violate.
        Assert.That(card.Violations, Has.Count.EqualTo(1));
        Assert.That(card.Violations[0].Path, Is.EqualTo("coverage.areaPct"));
    }

    [Test]
    public void Auto_match_does_not_pair_rooms_across_known_levels()
    {
        var theater = Oracle.Rooms.Single(room => room.Name == "Theater 010");
        var atticCandidate = new RhvacRoom(
            1,
            "Level 3/Attic:R01",
            theater.AreaSquareFeet,
            theater.CeilingHeightFeet
        );

        var card = RhvacEval.Score(
            new[] { atticCandidate },
            new OracleExtract(Oracle.SourceFile, new List<OracleRoom> { theater }),
            EmptyMap,
            Bootstrap
        );

        Assert.That(card.MatchedCount, Is.Zero);
        Assert.That(card.UnmatchedOracle, Has.One.Property("Name").EqualTo("Theater 010"));
        Assert.That(card.UnmatchedCandidates, Has.One.Property("Name").EqualTo("Level 3/Attic:R01"));
    }

    [Test]
    public void Entirely_missing_category_preserves_its_gate_severity()
    {
        var candidates = ToCandidates(Oracle);
        foreach (var wall in candidates.SelectMany(room => room.Walls))
            wall.Windows.Clear();

        var card = RhvacEval.Score(candidates, Oracle, FullMap(Oracle), Standard);

        Assert.That(card.Pass, Is.False);
        Assert.That(
            card.Violations,
            Has.One.Matches<RhvacEvalIssue>(issue =>
                issue.Path == "categoryMissing.glass" && issue.Metric == "glassArea"
            )
        );
    }

    [Test]
    public void Provisional_pairs_only_ever_warn()
    {
        // Same missing-glass takeoff, but matched provisionally: the rollup must demote to warning
        // because a breach against an unproven identity is diagnostic, not pass/fail evidence.
        var candidates = ToCandidates(Oracle);
        foreach (var wall in candidates.SelectMany(room => room.Walls))
            wall.Windows.Clear();

        var card = RhvacEval.Score(candidates, Oracle, EmptyMap, Standard);

        Assert.That(
            card.Warnings,
            Has.One.Matches<RhvacEvalIssue>(issue =>
                issue.Path == "categoryMissing.glass" && issue.Metric == "glassArea"
            )
        );
        Assert.That(
            card.Violations,
            Has.All.Matches<RhvacEvalIssue>(issue => issue.Path == "coverage.areaPct")
        );
    }

    /// <summary>Explicitly curates every oracle room to its own reconstruction ("R"+number).</summary>
    private static RoomMap FullMap(OracleExtract oracle) => new(
        oracle.Rooms.Select(room => new RoomMapMatch(room.Number, $"R{room.Number}")).ToList(),
        new List<RoomMapSkip>()
    );

    internal static string FindFixtureDir(
        [System.Runtime.CompilerServices.CallerFilePath] string sourcePath = ""
    )
    {
        // Not AppContext.BaseDirectory: the R25 harness bases that on the Revit install dir and
        // copies the whole test payload to temp, so no runtime path lands inside the repo. Walk
        // up from the assembly dir and cwd first (repo idiom), then from this file's compile-time
        // path, which always points into the repo on the machine that built the tests.
        var anchors = new[] {
            Path.GetDirectoryName(typeof(RhvacEvalTests).Assembly.Location),
            Directory.GetCurrentDirectory(),
            Path.GetDirectoryName(sourcePath),
        };
        foreach (var anchor in anchors)
        {
            var dir = string.IsNullOrWhiteSpace(anchor) ? null : new DirectoryInfo(anchor);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx")))
                dir = dir.Parent;
            if (dir is not null)
                return Path.Combine(dir.FullName, "eval", "rhvac", "project-a");
        }

        throw new InvalidOperationException(
            $"Pe.Tools.slnx not found above {string.Join(" or ", anchors)}."
        );
    }

    /// <summary>Rebuilds candidate rooms from the oracle inputs (a perfect takeoff by definition).</summary>
    private static List<RhvacRoom> ToCandidates(OracleExtract oracle)
    {
        var rooms = new List<RhvacRoom>();
        foreach (var source in oracle.Rooms)
        {
            var room = new RhvacRoom(
                source.Number,
                source.Name,
                source.AreaSquareFeet,
                source.CeilingHeightFeet
            );
            foreach (var floor in source.Floors)
                room.Floors.Add(new RhvacFloor(
                    new RhvacAssembly(floor.Assembly, floor.UValue),
                    floor.AreaSquareFeet,
                    floor.ExposedPerimeterFeet
                ));
            foreach (var roof in source.Roofs)
                room.Roofs.Add(new RhvacRoof(
                    new RhvacAssembly(roof.Assembly, roof.UValue),
                    roof.AreaSquareFeet,
                    roof.AreaMultiplier
                ));
            var wallsByIndex = new Dictionary<int, RhvacWall>();
            foreach (var wall in source.Walls)
            {
                var built = new RhvacWall(
                    new RhvacAssembly(wall.Assembly, wall.UValue),
                    wall.LengthFeet,
                    wall.HeightFeet,
                    (RhvacWallDirection)wall.Direction
                );
                room.Walls.Add(built);
                wallsByIndex[wall.Index1] = built;
            }

            foreach (var glass in source.Glass)
                wallsByIndex[glass.WallReference].Windows.Add(new RhvacWindow(
                    new RhvacAssembly(glass.Assembly, glass.UValue),
                    glass.WidthFeet,
                    glass.HeightFeet,
                    glass.Shgc,
                    glass.Occurrences
                ));
            foreach (var door in source.Doors)
                wallsByIndex[door.WallReference].Doors.Add(new RhvacDoor(
                    new RhvacAssembly(door.Assembly, door.UValue),
                    door.WidthFeet,
                    door.HeightFeet
                ));
            rooms.Add(room);
        }

        return rooms;
    }
}
