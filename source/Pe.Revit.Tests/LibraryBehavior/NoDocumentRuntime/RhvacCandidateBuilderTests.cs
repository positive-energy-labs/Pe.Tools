using Newtonsoft.Json;
using Pe.Revit.Takeoff;
using Pe.Revit.Takeoff.Rhvac;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// Synthetic-geometry tests for the takeoff -> RHVAC envelope converter, plus one integration run
// over the committed project-a TSV snapshot. No files are written.
public sealed class RhvacCandidateBuilderTests
{
    private static Conventions TestConventions(double trueNorthAngleRadians = 0) => new(
        trueNorthAngleRadians,
        RoofAreaMultiplier: 1.2,
        WallProbeFeet: 1.5,
        CoverageCellFeet: 1.0,
        UncoveredFractionThreshold: 0.15,
        SlabLevels: new List<string>(),
        Assemblies: new ConventionAssemblies(
            Wall: new RhvacAssembly("wall", 0.05),
            Roof: new RhvacAssembly("roof", 0.03),
            SlabFloor: new RhvacAssembly("slab", 0.02),
            FramedFloor: new RhvacAssembly("framed", 0.05)
        )
    );

    private static TakeoffRoomShape Square(string id, double x, double y, double side, double ceiling = 9) => new(
        id,
        RawSqft: side * side,
        PerimeterFt: 4 * side,
        MeanCeilingFt: ceiling,
        Outer: new List<double[]> {
            new[] { x, y },
            new[] { x + side, y },
            new[] { x + side, y + side },
            new[] { x, y + side },
        },
        Holes: new List<List<double[]>>()
    );

    [Test]
    public void Lone_square_room_gets_four_cardinal_walls()
    {
        var level = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> { Square("R01", 0, 0, 10) });

        var rooms = RhvacCandidateBuilder.Build(new[] { level }, TestConventions());

        Assert.That(rooms, Has.Count.EqualTo(1));
        var room = rooms[0];
        Assert.That(room.Name, Is.EqualTo("L1:R01"));
        Assert.That(room.Walls, Has.Count.EqualTo(4));
        Assert.That(
            room.Walls.Select(wall => wall.Direction),
            Is.EquivalentTo(new[] {
                RhvacWallDirection.North,
                RhvacWallDirection.East,
                RhvacWallDirection.South,
                RhvacWallDirection.West,
            })
        );
        foreach (var wall in room.Walls)
        {
            Assert.That(wall.LengthFeet, Is.EqualTo(10).Within(1e-9));
            Assert.That(wall.HeightFeet, Is.EqualTo(9).Within(1e-9));
        }
    }

    [Test]
    public void Shared_edge_is_interior_on_both_rooms()
    {
        var level = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> {
            Square("R01", 0, 0, 10),
            Square("R02", 10, 0, 10),
        });

        var rooms = RhvacCandidateBuilder.Build(new[] { level }, TestConventions());

        var left = rooms.Single(room => room.Name == "L1:R01");
        var right = rooms.Single(room => room.Name == "L1:R02");
        Assert.That(left.Walls, Has.Count.EqualTo(3));
        Assert.That(left.Walls.Select(wall => wall.Direction), Does.Not.Contain(RhvacWallDirection.East));
        Assert.That(right.Walls, Has.Count.EqualTo(3));
        Assert.That(right.Walls.Select(wall => wall.Direction), Does.Not.Contain(RhvacWallDirection.West));
    }

    [Test]
    public void True_north_rotation_shifts_wall_buckets_one_step()
    {
        var level = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> { Square("R01", 0, 0, 10) });

        var rooms = RhvacCandidateBuilder.Build(new[] { level }, TestConventions(Math.PI / 4));

        Assert.That(
            rooms[0].Walls.Select(wall => wall.Direction),
            Is.EquivalentTo(new[] {
                RhvacWallDirection.NorthEast,
                RhvacWallDirection.SouthEast,
                RhvacWallDirection.SouthWest,
                RhvacWallDirection.NorthWest,
            })
        );
    }

    [Test]
    public void Identical_stacked_squares_yield_roof_only_on_top()
    {
        var lower = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> { Square("R01", 0, 0, 10) });
        var upper = new LevelTakeoff("L2", 10, new List<TakeoffRoomShape> { Square("R01", 0, 0, 10) });

        var rooms = RhvacCandidateBuilder.Build(new[] { lower, upper }, TestConventions());

        var lowerRoom = rooms.Single(room => room.Name == "L1:R01");
        var upperRoom = rooms.Single(room => room.Name == "L2:R01");
        Assert.That(lowerRoom.Floors, Is.Empty); // bottom level, not slab: conventions gap, no row
        Assert.That(lowerRoom.Roofs, Is.Empty);  // fully covered by the level above
        Assert.That(upperRoom.Floors, Is.Empty); // fully over conditioned space
        Assert.That(upperRoom.Roofs, Has.Count.EqualTo(1));
        Assert.That(upperRoom.Roofs[0].AreaSquareFeet, Is.EqualTo(100).Within(1e-9));
        Assert.That(upperRoom.Roofs[0].AreaMultiplier, Is.EqualTo(1.2).Within(1e-9));
    }

    [Test]
    public void Half_overlap_puts_half_area_roof_on_the_lower_room()
    {
        var lower = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> { Square("R01", 0, 0, 10) });
        var upper = new LevelTakeoff("L2", 10, new List<TakeoffRoomShape> { Square("R01", 5, 0, 10) });

        var rooms = RhvacCandidateBuilder.Build(new[] { lower, upper }, TestConventions());

        var lowerRoom = rooms.Single(room => room.Name == "L1:R01");
        var upperRoom = rooms.Single(room => room.Name == "L2:R01");
        Assert.That(lowerRoom.Roofs, Has.Count.EqualTo(1));
        Assert.That(lowerRoom.Roofs[0].AreaSquareFeet, Is.EqualTo(50).Within(1e-9));
        // Half hangs past the lower room, so only that exposed half becomes a floor row.
        Assert.That(upperRoom.Floors, Has.Count.EqualTo(1));
        Assert.That(upperRoom.Floors[0].AreaSquareFeet, Is.EqualTo(50).Within(1e-9));
        Assert.That(upperRoom.Floors[0].Assembly.Name, Is.EqualTo("framed"));
    }

    [Test]
    public void Grid_pitch_uses_repeated_raster_steps_not_micro_snaps_or_long_walls()
    {
        var loops = Enumerable.Range(0, 100)
            .Select(index => Square($"R{index}", index * 20, 0, 10).Outer)
            .Append(new List<double[]> {
                new[] { 0.0, 0.0 },
                new[] { 0.000005, 0.0 },
                new[] { 0.250005, 0.0 },
                new[] { 0.500005, 0.0 },
                new[] { 0.750005, 0.0 },
                new[] { 1.000005, 0.0 },
                new[] { 1.000005, 0.25 },
                new[] { 1.000005, 0.5 },
                new[] { 0.0, 0.5 },
            });

        Assert.That(RhvacCandidateBuilder.DeriveGridPitch(loops), Is.EqualTo(0.25));
    }

    [Test]
    public void Split_resolution_changes_candidate_output_deterministically_and_idempotently()
    {
        var projectDir = Path.Combine(Path.GetTempPath(), $"pe-rhvac-resolutions-{Guid.NewGuid():N}");
        var takeoffDir = Path.Combine(projectDir, "takeoff");
        Directory.CreateDirectory(takeoffDir);
        var tsv = string.Join("\n", new[] {
            "META\tlevel\tL1",
            "META\telev\t0.000000",
            "META\trooms\t2",
            "META\ttotalSqft\t1300.0",
            "ROOM\tR01\t1200.0\t140.0\t20.0\t15.0\t9.00",
            "POLY\tR01\touter\t0;0|40;0|40;30|0;30",
            "ROOM\tR02\t100.0\t40.0\t55.0\t5.0\t9.00",
            "POLY\tR02\touter\t50;0|60;0|60;10|50;10",
            "META\tflag\tR02:low-evidence-boundary",
            "",
        });
        var sidecar = Path.Combine(projectDir, "takeoff-resolutions.json");

        try
        {
            File.WriteAllText(Path.Combine(takeoffDir, "rooms_L1.tsv"), tsv);
            File.WriteAllText(sidecar, """
                {
                  "version": 1,
                  "resolutions": [
                    {
                      "candidateKey": "L1:R01",
                      "flag": "open-plan-merge",
                      "action": "split",
                      "params": { "a": [15, 0], "b": [15, 30] },
                      "anchor": { "label": [20, 15], "sqft": 1200 }
                    },
                    {
                      "candidateKey": "L1:R02",
                      "flag": "low-evidence-boundary",
                      "action": "accept",
                      "anchor": { "label": [55, 5], "sqft": 100 }
                    }
                  ]
                }
                """);

            var resolved = RhvacCandidateBuilder.ParseTsvDirectory(takeoffDir).Levels;
            var reapplied = RhvacCandidateBuilder.ApplyResolutions(resolved, sidecar).Levels;
            var firstCandidates = RhvacCandidateBuilder.Build(resolved, TestConventions());
            var secondCandidates = RhvacCandidateBuilder.Build(reapplied, TestConventions());

            Assert.Multiple(() => {
                Assert.That(resolved.Single().Rooms.Select(room => room.Id),
                    Is.EqualTo(new[] { "R01.a", "R01.b", "R02" }));
                Assert.That(resolved.Single().Rooms.Select(room => room.RawSqft),
                    Is.EqualTo(new[] { 750.0, 450.0, 100.0 }));
                Assert.That(resolved.Single().Rooms.Take(2).Select(room => room.SplitFrom),
                    Is.All.EqualTo("R01"));
                Assert.That(resolved.Single().Rooms.SelectMany(room => room.Flags), Is.Empty);
                Assert.That(firstCandidates.Select(room => room.Name),
                    Is.EqualTo(new[] { "L1:R01.a", "L1:R01.b", "L1:R02" }));
                Assert.That(JsonConvert.SerializeObject(secondCandidates),
                    Is.EqualTo(JsonConvert.SerializeObject(firstCandidates)), "reapply must be idempotent");
                Assert.That(
                    JsonConvert.SerializeObject(RhvacCandidateBuilder.Build(
                        RhvacCandidateBuilder.ParseTsvDirectory(takeoffDir).Levels, TestConventions())),
                    Is.EqualTo(JsonConvert.SerializeObject(firstCandidates)), "fresh parse must be deterministic");
            });

            File.WriteAllText(sidecar, File.ReadAllText(sidecar).Replace("\"version\": 1", "\"version\": 2"));
            Assert.That(
                RhvacCandidateBuilder.ParseTsvDirectory(takeoffDir).Levels.Single().Rooms.Select(room => room.Id),
                Is.EqualTo(new[] { "R01.a", "R01.b", "R02" }),
                "v2 sidecars without reject/merge remain compatible");
        }
        finally
        {
            if (Directory.Exists(projectDir)) Directory.Delete(projectDir, recursive: true);
        }
    }

    [Test]
    public void V2_resolutions_survive_rank_reshuffle_by_geometric_anchor_without_silent_drops()
    {
        var fixturePath = Path.GetFullPath(Path.Combine(
            RhvacEvalTests.FindFixtureDir(), "..", "fixtures", "sidecar-anchor-remap.json"));
        var fixture = JsonConvert.DeserializeObject<AnchorRemapFixture>(File.ReadAllText(fixturePath))!;
        var sidecarPath = Path.GetTempFileName();
        try
        {
            File.WriteAllText(sidecarPath, JsonConvert.SerializeObject(fixture.Sidecar));
            var before = RhvacCandidateBuilder.ApplyResolutions(
                new[] { RhvacCandidateBuilder.ParseTsv(fixture.BeforeTsv) }, sidecarPath);
            var result = RhvacCandidateBuilder.ApplyResolutions(
                new[] { RhvacCandidateBuilder.ParseTsv(fixture.AfterTsv) }, sidecarPath);

            Assert.Multiple(() => {
                Assert.That((before.Applied, before.Remapped, before.Orphaned),
                    Is.EqualTo((4, 0, 2)));
                Assert.That(result.Applied, Is.EqualTo(fixture.Expected.Applied));
                Assert.That(result.Remapped, Is.EqualTo(fixture.Expected.Remapped));
                Assert.That(result.Orphaned, Is.EqualTo(fixture.Expected.Orphaned));
                Assert.That(result.Levels.Single().Rooms.Select(room => room.Id),
                    Is.EqualTo(fixture.Expected.RoomIds));
                Assert.That(result.Levels.Single().Rooms.Select(room => room.RawSqft),
                    Is.EqualTo(fixture.Expected.RoomSqft));
                Assert.That(result.Levels.Single().Rooms.Select(room => room.Label),
                    Is.EqualTo(fixture.Expected.RoomLabels));
                Assert.That(result.Levels.Single().Rooms.Select(room => room.Id),
                    Does.Not.Contain(fixture.Expected.RejectedRoomId));
                Assert.That(result.Levels.Single().Residues.Single(residue =>
                        residue.Reason == ResidueReason.Rejected && residue.Claimed).Id,
                    Is.EqualTo(fixture.Expected.RejectedRoomId));
                Assert.That(result.Levels.Single().Rooms.Single(room => room.Id == "R01").MergedFrom,
                    Is.EqualTo(fixture.Expected.MergedFrom));
                Assert.That(result.Applied + result.Remapped + result.Orphaned,
                    Is.EqualTo(fixture.Sidecar.Resolutions.Count));
            });
        }
        finally
        {
            File.Delete(sidecarPath);
        }
    }

    [Test]
    public void Claim_residue_unions_or_promotes_and_survives_renumbering()
    {
        var fixturePath = Path.GetFullPath(Path.Combine(
            RhvacEvalTests.FindFixtureDir(), "..", "fixtures", "residue-claim-remap.json"));
        var fixture = JsonConvert.DeserializeObject<ResidueClaimFixture>(File.ReadAllText(fixturePath))!;
        var sidecarPath = Path.GetTempFileName();
        try
        {
            File.WriteAllText(sidecarPath, JsonConvert.SerializeObject(fixture.Sidecar));
            var before = RhvacCandidateBuilder.ApplyResolutions(
                new[] { RhvacCandidateBuilder.ParseTsv(fixture.BeforeTsv) }, sidecarPath);
            var after = RhvacCandidateBuilder.ApplyResolutions(
                new[] { RhvacCandidateBuilder.ParseTsv(fixture.AfterTsv) }, sidecarPath);

            Assert.Multiple(() => {
                Assert.That((before.Applied, before.Remapped, before.Orphaned), Is.EqualTo((2, 0, 0)));
                Assert.That((after.Applied, after.Remapped, after.Orphaned), Is.EqualTo((0, 2, 0)));
                Assert.That(after.Levels.Single().Rooms.Select(room => room.Id),
                    Is.EqualTo(new[] { "R01", "R02", "X10" }));
                Assert.That(after.Levels.Single().Rooms.Select(room => room.RawSqft),
                    Is.EqualTo(new[] { 200.0, 100.0, 100.0 }));
                Assert.That(after.Levels.Single().Residues, Is.Empty);
            });
        }
        finally
        {
            File.Delete(sidecarPath);
        }
    }

    private sealed record ResidueClaimFixture(string BeforeTsv, string AfterTsv, object Sidecar);

    private sealed record AnchorRemapFixture(
        string BeforeTsv,
        string AfterTsv,
        AnchorRemapSidecar Sidecar,
        AnchorRemapExpected Expected
    );

    private sealed record AnchorRemapSidecar(int Version, List<object> Resolutions);

    private sealed record AnchorRemapExpected(
        int Applied,
        int Remapped,
        int Orphaned,
        List<string> RoomIds,
        List<double> RoomSqft,
        List<double[]> RoomLabels,
        string MergedFrom,
        string RejectedRoomId
    );

    [Test]
    public void ProjectA_main_four_verb_sidecar_round_trips_with_expected_rooms_and_areas()
    {
        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var takeoffDir = Path.Combine(fixtureDir, "takeoff");
        var sidecar = Path.GetFullPath(Path.Combine(
            fixtureDir, "..", "fixtures", "project-a-main-four-verbs.json"));

        var result = RhvacCandidateBuilder.ParseTsvDirectory(takeoffDir, sidecar);
        var main = result.Levels.Single(level => level.LevelName == "Level 1/Main Level");

        Assert.Multiple(() => {
            Assert.That((result.Applied, result.Remapped, result.Orphaned), Is.EqualTo((4, 0, 0)));
            Assert.That(main.Rooms, Has.Count.EqualTo(81));
            Assert.That(main.Rooms.Select(room => room.Id), Does.Not.Contain("R06"));
            Assert.That(main.Rooms.Select(room => room.Id), Does.Not.Contain("R07"));
            Assert.That(main.Rooms.Select(room => room.Id), Does.Not.Contain("R09"));
            Assert.That(main.Rooms.Single(room => room.Id == "R03").RawSqft,
                Is.EqualTo(1436.2).Within(1e-6));
            Assert.That(main.Rooms.Where(room => room.SplitFrom == "R07").Select(room => room.RawSqft),
                Is.EqualTo(new[] { 408.0, 353.125 }).Within(1e-6));
            var merged = main.Rooms.Single(room => room.Id == "R13");
            Assert.That(merged.RawSqft, Is.EqualTo(1049.6).Within(1e-6));
            Assert.That(merged.MergedFrom, Is.EqualTo("R09"));
        });
    }

    [Test]
    public void Chained_merges_compose_without_losing_the_first_source()
    {
        var level = new LevelTakeoff("L1", 0, new List<TakeoffRoomShape> {
            Square("R01", 0, 0, 10),
            Square("R02", 10, 0, 10),
            Square("R03", 20, 0, 10),
        });
        var sidecar = Path.GetTempFileName();
        try
        {
            File.WriteAllText(sidecar, """
                {
                  "version": 2,
                  "resolutions": [
                    {
                      "candidateKey": "L1:R01",
                      "flag": "low-evidence-boundary",
                      "action": "merge",
                      "params": { "other": "L1:R02", "anchor": { "label": [15, 5], "sqft": 100 } },
                      "anchor": { "label": [5, 5], "sqft": 100 }
                    },
                    {
                      "candidateKey": "L1:R02",
                      "flag": "low-evidence-boundary",
                      "action": "merge",
                      "params": { "other": "L1:R03", "anchor": { "label": [25, 5], "sqft": 100 } },
                      "anchor": { "label": [15, 5], "sqft": 100 }
                    }
                  ]
                }
                """);

            var result = RhvacCandidateBuilder.ApplyResolutions(new[] { level }, sidecar);

            Assert.That((result.Applied, result.Remapped, result.Orphaned), Is.EqualTo((2, 0, 0)));
            Assert.That(result.Levels.Single().Rooms.Select(room => (room.Id, room.RawSqft)),
                Is.EqualTo(new[] { ("R03", 300.0) }));
        }
        finally
        {
            File.Delete(sidecar);
        }
    }

    [Test]
    public void ProjectA_simplification_preserves_area_and_collapses_staircases()
    {
        static double Shoelace(List<double[]> loop)
        {
            var sum = 0.0;
            for (int i = 0, j = loop.Count - 1; i < loop.Count; j = i++)
                sum += (loop[j][0] * loop[i][1]) - (loop[i][0] * loop[j][1]);
            return sum / 2;
        }

        static double NetArea(TakeoffRoomShape shape) =>
            Math.Abs(Shoelace(shape.Outer)) - shape.Holes.Sum(hole => Math.Abs(Shoelace(hole)));

        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var tsvPaths = Directory.GetFiles(Path.Combine(fixtureDir, "takeoff"), "rooms_*.tsv");
        Assert.That(tsvPaths, Is.Not.Empty);

        var rawVertices = 0;
        var simplifiedVertices = 0;
        foreach (var path in tsvPaths)
        {
            var text = File.ReadAllText(path);
            var raw = RhvacCandidateBuilder.ParseTsv(text, simplify: false);
            var simplified = RhvacCandidateBuilder.ParseTsv(text);
            Assert.That(simplified.Rooms, Has.Count.EqualTo(raw.Rooms.Count));
            for (var i = 0; i < raw.Rooms.Count; i++)
            {
                var before = raw.Rooms[i];
                var after = simplified.Rooms[i];
                // Area is the exported truth — simplification must not drift it materially.
                var areaBefore = NetArea(before);
                Assert.That(
                    Math.Abs(NetArea(after) - areaBefore),
                    Is.LessThanOrEqualTo(Math.Max(0.5, 0.01 * areaBefore)),
                    $"{raw.LevelName}:{before.Id} area drifted."
                );
                Assert.That(after.Outer, Has.Count.LessThanOrEqualTo(before.Outer.Count));
                rawVertices += before.Outer.Count;
                simplifiedVertices += after.Outer.Count;
            }
        }

        // Staircases of hundreds of points must come back as tens of segments.
        Assert.That(simplifiedVertices, Is.LessThan(rawVertices / 4));
    }

    [Test]
    public void ProjectA_snapshot_builds_a_plausible_envelope()
    {
        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var takeoffDir = Path.Combine(fixtureDir, "takeoff");
        var tsvPaths = Directory.GetFiles(takeoffDir, "rooms_*.tsv");
        Assert.That(tsvPaths, Has.Length.EqualTo(5));

        var levels = RhvacCandidateBuilder.ParseTsvDirectory(takeoffDir).Levels
            .OrderBy(level => level.Elevation)
            .ToList();
        var conventions = RhvacCandidateBuilder.LoadConventions(Path.Combine(fixtureDir, "conventions.json"));

        var rooms = RhvacCandidateBuilder.Build(levels, conventions);

        // One candidate per TSV room — derived from the snapshot itself so re-snapshots don't
        // require a magic-number edit here (the TSVs already self-check META rooms vs ROOM lines).
        Assert.That(rooms, Has.Count.EqualTo(levels.Sum(level => level.Rooms.Count)));
        Assert.That(rooms, Has.Some.Property("Name").EqualTo("Level 0/Theatre:R01"));
        var walls = rooms.SelectMany(room => room.Walls).ToList();
        Assert.That(walls, Is.Not.Empty);
        Assert.That(
            walls,
            Has.All.Matches<RhvacWall>(wall => Enum.IsDefined(typeof(RhvacWallDirection), wall.Direction))
        );
        Assert.That(walls.Sum(wall => wall.LengthFeet * wall.HeightFeet), Is.GreaterThan(0));
        Assert.That(
            rooms.SelectMany(room => room.Floors),
            Has.Some.Matches<RhvacFloor>(floor =>
                floor.Assembly.Name == conventions.Assemblies.SlabFloor.Name
                && floor.ExposedPerimeterFeet > 0
            )
        );
        Assert.That(
            rooms.Where(room => room.Name.StartsWith("Level 3/Attic:", StringComparison.Ordinal)),
            Has.Some.Matches<RhvacRoom>(room => room.Roofs.Count > 0)
        );
        foreach (var room in rooms)
            Assert.That(room.Validate(), Is.Empty, $"{room.Name} failed shape validation.");
    }
}
