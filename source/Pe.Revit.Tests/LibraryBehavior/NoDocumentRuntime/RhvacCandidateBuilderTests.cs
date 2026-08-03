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
        var tsvPaths = Directory.GetFiles(Path.Combine(fixtureDir, "takeoff"), "rooms_*.tsv");
        Assert.That(tsvPaths, Has.Length.EqualTo(5));

        var levels = tsvPaths
            .Select(path => RhvacCandidateBuilder.ParseTsv(File.ReadAllText(path)))
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
