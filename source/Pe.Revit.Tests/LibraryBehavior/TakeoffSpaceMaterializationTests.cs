using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior;

public sealed class TakeoffSpaceMaterializationTests
{
    [Test]
    public void Boundary_network_nodes_and_deduplicates_shared_edges()
    {
        var rooms = new[] {
            Room("A", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4)),
            Room("B", Polygon(10, 0, 20, 5)),
            Room("C", Polygon(10, 5, 20, 10)),
        };

        var actual = SpaceBoundaryNetwork.Build(rooms);

        Assert.Multiple(() => {
            Assert.That(actual, Has.Count.EqualTo(14));
            Assert.That(actual.Select(BoundaryKey).Distinct(), Has.Count.EqualTo(actual.Count));
            Assert.That(actual, Has.Some.Matches<BoundaryCurve>(line =>
                BoundaryKey(line) == "10,0|10,5"));
            Assert.That(actual, Has.Some.Matches<BoundaryCurve>(line =>
                BoundaryKey(line) == "10,5|10,10"));
            Assert.That(actual, Has.None.Matches<BoundaryCurve>(line =>
                BoundaryKey(line) == "10,0|10,10"));
        });
    }

    [Test]
    public void Boundary_network_reduces_raster_stairs_to_physical_segments()
    {
        var stairSteppedTrapezoid = new List<double[]> {
            new[] { 0d, 4 }, new[] { 0d, 3 }, new[] { 1d, 3 }, new[] { 1d, 2 },
            new[] { 2d, 2 }, new[] { 2d, 1 }, new[] { 3d, 1 }, new[] { 3d, 0 },
            new[] { 12d, 0 }, new[] { 12d, 1 }, new[] { 11d, 1 }, new[] { 11d, 2 },
            new[] { 10d, 2 }, new[] { 10d, 3 }, new[] { 9d, 3 }, new[] { 9d, 4 },
        };

        var rooms = new[] { Room("A", stairSteppedTrapezoid) };
        SpaceBoundaryNetwork.Regularize(rooms, 1);
        var actual = SpaceBoundaryNetwork.Build(rooms);

        Assert.Multiple(() => {
            Assert.That(actual, Has.Count.EqualTo(4));
            Assert.That(NetworkArea(actual), Is.EqualTo(Math.Abs(Area(stairSteppedTrapezoid))).Within(1e-5));
        });
    }

    [Test]
    public void Boundary_network_aligns_supported_shared_edges_to_a_local_wall_family()
    {
        const double rise = 6.494;
        var rooms = new[] {
            Room("A", [new[] { 0d, 0 }, new[] { 10d, 0 }, new[] { 0d, rise }]),
            Room("B", [new[] { 0d, rise }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 0d, 10 }]),
            Room("C", [new[] { 0d, 20 }, new[] { 10d, 20 }, new[] { 0d, 20 + rise }]),
            Room("D", [new[] { 0d, 20 + rise }, new[] { 10d, 20 }, new[] { 10d, 30 }, new[] { 0d, 30 }]),
        };
        double nx = 0.5, ny = Math.Sqrt(3) / 2;
        bool WallAt(double x, double y) => new[] { rise / 2, 20 + rise / 2 }
            .Any(midY => Math.Abs(nx * x + ny * y - (nx * 5 + ny * midY)) <= 0.3);

        SpaceBoundaryNetwork.Regularize(rooms, 0.5, cellFt: 0.25, wallAt: WallAt);

        double angle = SharedAngle(rooms[0], rooms[1]);
        Assert.Multiple(() => {
            Assert.That(angle, Is.EqualTo(-30).Within(0.1),
                "the evidence family, not the generic -33 degree chord, owns direction");
            Assert.That(SharedAngle(rooms[2], rooms[3]), Is.EqualTo(angle).Within(1e-6));
        });
    }

    [Test]
    public void Boundary_network_leaves_edges_without_wall_support_unsnapped()
    {
        const double rise = 6.494;
        var rooms = new[] {
            Room("A", [new[] { 0d, 0 }, new[] { 10d, 0 }, new[] { 0d, rise }]),
            Room("B", [new[] { 0d, rise }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 0d, 10 }]),
            Room("C", [new[] { 0d, 20 }, new[] { 10d, 20 }, new[] { 0d, 20 + rise }]),
            Room("D", [new[] { 0d, 20 + rise }, new[] { 10d, 20 }, new[] { 10d, 30 }, new[] { 0d, 30 }]),
        };

        SpaceBoundaryNetwork.Regularize(rooms, 0.5, cellFt: 0.25, wallAt: (_, _) => false);

        Assert.That(SharedAngle(rooms[0], rooms[1]), Is.EqualTo(-33).Within(0.1));
    }

    [Test]
    public void Spaces_replace_idempotently_and_cleanup_completely(UIApplication uiApplication)
    {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var logs = new List<string>();
        try
        {
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(item => item.Elevation).First();
            var phase = document.Phases.Cast<Phase>().Last();
            var third = Room("R03", Polygon(20, 0, 30, 10));
            var result = new TakeoffResult {
                LevelName = level.Name,
                LevelElevation = level.ProjectElevation,
                Rooms = {
                    Room("R01", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4)),
                    Room("R02", Polygon(10, 0, 20, 10)),
                    third,
                    Room("R04", Polygon(40, 0, 60, 1)),
                },
                Residues = {
                    new ResidueResult {
                        Id = "X01", Reason = ResidueReason.Rejected, RawSqft = 100,
                        LabelX = 35, LabelY = 5, MeanCeilingFt = 10,
                        Polygon = Polygon(30, 0, 40, 10),
                    },
                    new ResidueResult {
                        Id = "X02", Reason = ResidueReason.Rejected, RawSqft = 50,
                        LabelX = 70, LabelY = 5, MeanCeilingFt = 10,
                        Polygon = SelfTouchingPolygon(),
                    },
                },
                TotalSqft = 366,
            };
            var options = new TakeoffOptions { Marker = "PE-TEST-TAKEOFF" };

            using var transaction = new Transaction(document, "Prove takeoff Space materialization");
            transaction.Start();

            var first = SpaceMaterializer.Replace(document, level, phase, result, options, Log);
            document.Regenerate();
            AssertMaterialization(document, first, options, level, phase, logs);

            var second = SpaceMaterializer.Replace(document, level, phase, result, options, Log);
            document.Regenerate();
            Assert.That(second.Spaces, Has.Count.EqualTo(3));
            Assert.That(second.Spaces, Has.None.Matches<ElementId>(id => first.Spaces.Contains(id)));
            AssertMaterialization(document, second, options, level, phase, logs);

            SpaceMaterializer.Cleanup(document, options, TestContext.WriteLine);
            document.Regenerate();
            Assert.That(Owned(document, options), Is.Empty);
            Assert.That(BoundaryLines(document, options), Is.Empty);
            Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
        }
        finally
        {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }

        void Log(string message)
        {
            logs.Add(message);
            TestContext.WriteLine(message);
        }
    }

    [Test]
    public void Materialized_spaces_round_trip_through_native_readback(UIApplication uiApplication)
    {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var takeoffDirectory = Path.Combine(Path.GetTempPath(), $"pe-native-readback-{Guid.NewGuid():N}");
        try
        {
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(item => item.Elevation).First();
            var phase = document.Phases.Cast<Phase>().Last();
            var options = new TakeoffOptions { Marker = "PE-TEST-NATIVE" };
            var logs = new List<string>();

            using var transaction = new Transaction(document, "Prove native Space readback");
            transaction.Start();
            var materialized = MaterializeReadbackFixture(document, level, phase, options);
            document.Regenerate();

            var readback = RoomTakeoff.ReadbackNative(
                document, level, phase, takeoffDirectory, options, logs.Add);
            var parsed = TakeoffTsv.ParseTsv(File.ReadAllText(readback.PathWritten));
            var spaces = materialized.Spaces.Select(id => (Space)document.GetElement(id)).ToList();

            Assert.Multiple(() => {
                Assert.That(readback.SpacesRead, Is.EqualTo(spaces.Count));
                Assert.That((readback.SkippedUnplaced, readback.SkippedUnenclosed), Is.EqualTo((0, 0)));
                Assert.That(parsed.Source, Is.EqualTo(TakeoffSource.Native));
                Assert.That(parsed.Rooms.Select(room => room.Id),
                    Is.EquivalentTo(spaces.Select(space => space.Number)));
                Assert.That(logs, Has.Some.Contains("skippedUnplaced=0 skippedUnenclosed=0"));
                foreach (var space in spaces)
                    Assert.That(parsed.Rooms.Single(room => room.Id == space.Number).RawSqft,
                        Is.EqualTo(space.Area).Within(0.1));
            });
            Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
        }
        finally
        {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (Directory.Exists(takeoffDirectory)) Directory.Delete(takeoffDirectory, recursive: true);
        }
    }

    [Test]
    public void Native_readback_follows_a_human_renumber(UIApplication uiApplication)
    {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        var takeoffDirectory = Path.Combine(Path.GetTempPath(), $"pe-native-renumber-{Guid.NewGuid():N}");
        try
        {
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(item => item.Elevation).First();
            var phase = document.Phases.Cast<Phase>().Last();
            var options = new TakeoffOptions { Marker = "PE-TEST-NATIVE-RENUMBER" };

            using var transaction = new Transaction(document, "Prove native Space renumber readback");
            transaction.Start();
            var materialized = MaterializeReadbackFixture(document, level, phase, options);
            document.Regenerate();
            var initial = RoomTakeoff.ReadbackNative(
                document, level, phase, takeoffDirectory, options, TestContext.WriteLine);
            var initialId = ((Space)document.GetElement(materialized.Spaces[0])).Number;

            var renumbered = (Space)document.GetElement(materialized.Spaces[0]);
            renumbered.Number = "HUMAN-101";
            Assert.That(renumbered.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.Set(""), Is.True);
            document.Regenerate();
            var updated = RoomTakeoff.ReadbackNative(
                document, level, phase, takeoffDirectory, options, TestContext.WriteLine);
            var parsed = TakeoffTsv.ParseTsv(File.ReadAllText(updated.PathWritten));

            Assert.Multiple(() => {
                Assert.That(updated.PathWritten, Is.EqualTo(initial.PathWritten));
                Assert.That(parsed.Source, Is.EqualTo(TakeoffSource.Native));
                Assert.That(parsed.Rooms.Select(room => room.Id), Does.Contain("HUMAN-101"));
                Assert.That(parsed.Rooms.Select(room => room.Id), Does.Not.Contain(initialId));
            });
            Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
        }
        finally
        {
            RevitFamilyFixtureHarness.CloseDocument(document);
            if (Directory.Exists(takeoffDirectory)) Directory.Delete(takeoffDirectory, recursive: true);
        }
    }

    [Test]
    public void ProjectA_materialization_accounts_for_every_room_and_residue(UIApplication uiApplication)
    {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try
        {
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(item => item.Elevation).First();
            var phase = document.Phases.Cast<Phase>().Last();
            var fixtureDir = NoDocumentRuntime.RhvacEvalTests.FindFixtureDir();
            var takeoffDir = Path.Combine(fixtureDir, "takeoff");
            var sidecar = Path.GetFullPath(Path.Combine(
                fixtureDir, "..", "fixtures", "project-a-main-four-verbs.json"));
            var result = RoomTakeoff.LoadMaterializationResult(
                takeoffDir, "Level 1/Main Level", sidecar).Takeoff;
            var options = new TakeoffOptions { Marker = "PE-TEST-project-a" };
            var logs = new List<string>();

            using var transaction = new Transaction(document, "Prove project-a materialization census");
            transaction.Start();
            var materialized = SpaceMaterializer.Replace(
                document, level, phase, result, options, message => {
                    logs.Add(message);
                    TestContext.WriteLine(message);
                });
            document.Regenerate();

            foreach (var failure in logs.Where(message => message.Contains("ring repair failed:")))
                TestContext.Progress.WriteLine($"[project-a-fr-failure] {failure}");
            TestContext.Progress.WriteLine(
                $"[project-a-census] spaces={materialized.Spaces.Count} " +
                $"filledRegions={materialized.FilledRegions} lineFallbacks={materialized.LineFallbacks} " +
                $"filledRegionFailures={materialized.FilledRegionFailures} rooms={materialized.Rooms} " +
                $"residues={materialized.Residues} defectors={materialized.Defectors}");
            Assert.Multiple(() => {
                Assert.That(materialized.AccountingHolds, Is.True);
                Assert.That(materialized.DeletedWithoutReplacement, Is.Zero);
                // 2026-08-10 straightened-geometry census: every polygon ships straight (no line
                // fallbacks, no FR failures), the border residue is logged-not-drawn, and the
                // blank-doc shape gate defects more small rooms than the live doc does.
                Assert.That((materialized.Spaces.Count, materialized.FilledRegions, materialized.LineFallbacks,
                        materialized.FilledRegionFailures, materialized.Rooms, materialized.Residues,
                        materialized.Defectors),
                    Is.EqualTo((18, 65, 0, 0, 64, 2, 17)));
                Assert.That(logs.Count(message => message.Contains("ring repair failed:")), Is.EqualTo(0));
            });
            SpaceMaterializer.Cleanup(document, options, TestContext.WriteLine);
            document.Regenerate();
            Assert.That(Owned(document, options), Is.Empty);
            Assert.That(BoundaryLines(document, options), Is.Empty);
            Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
        }
        finally
        {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }

    private static void AssertMaterialization(
        Document document, SpaceMaterializationResult result, TakeoffOptions options, Level level, Phase phase,
        IReadOnlyList<string> logs)
    {
        var owned = Owned(document, options);
        var spaces = result.Spaces.Select(id => document.GetElement(id)).Cast<Space>()
            .OrderBy(space => space.Number).ToList();
        var filledRegions = owned.OfType<FilledRegion>().ToList();
        Assert.Multiple(() => {
            Assert.That(result.AccountingHolds, Is.True,
                "spaces + filled regions + line fallbacks must equal rooms + residues + defectors");
            Assert.That((result.Spaces.Count, result.FilledRegions, result.LineFallbacks,
                    result.FilledRegionFailures, result.Rooms, result.Residues, result.Defectors,
                    result.DeletedWithoutReplacement),
                Is.EqualTo((3, 3, 0, 0, 3, 2, 1, 0)));
            Assert.That(spaces, Has.Count.EqualTo(3));
            Assert.That(spaces[0].Area, Is.EqualTo(96).Within(0.01));
            Assert.That(spaces[1].Area, Is.EqualTo(100).Within(0.01));
            Assert.That(spaces[2].Area, Is.EqualTo(100).Within(0.01));
            Assert.That(spaces.Select(space => space.Number),
                Is.EquivalentTo(new[] { "R01", "R02", "R03" }));
            Assert.That(spaces.All(space => space.LevelId.Value() == level.Id.Value()
                                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)
                                                ?.AsElementId().Value() == phase.Id.Value()), Is.True);
            Assert.That(spaces[0].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(2));
            Assert.That(spaces[1].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(1));
            var firstPoint = ((LocationPoint)spaces[0].Location).Point;
            var secondPoint = ((LocationPoint)spaces[1].Location).Point;
            Assert.That(Math.Abs(firstPoint.X - 5) + Math.Abs(firstPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(Math.Abs(secondPoint.X - 15) + Math.Abs(secondPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(owned.Count(element => element is Space), Is.EqualTo(3));
            Assert.That(filledRegions.Count, Is.GreaterThanOrEqualTo(result.FilledRegions));
            Assert.That(filledRegions.Select(SpaceMaterializer.Comments),
                Has.Some.Contains("|R04\npe-takeoff: shape-defect=sliver"));
            Assert.That(filledRegions.Select(SpaceMaterializer.Comments),
                Has.Some.Contains("|X01\npe-takeoff: residue=rejected"));
            Assert.That(filledRegions, Has.Some.Matches<FilledRegion>(region =>
                SpaceMaterializer.Comments(region)?.Contains("|X02\npe-takeoff: residue=rejected") == true));
            Assert.That(logs, Has.Some.Contains("[spaces] X02 ring repaired:"));
            Assert.That(BoundaryLines(document, options), Has.Count.EqualTo(18));
        });
    }

    private static SpaceMaterializationResult MaterializeReadbackFixture(
        Document document, Level level, Phase phase, TakeoffOptions options)
    {
        var first = Room("R01", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4));
        var second = Room("R02", Polygon(10, 0, 20, 10));
        var takeoff = new TakeoffResult {
            LevelName = level.Name,
            LevelElevation = level.ProjectElevation,
            Rooms = { first, second },
            TotalSqft = first.RawSqft + second.RawSqft,
        };
        return SpaceMaterializer.Replace(
            document, level, phase, takeoff, options, TestContext.WriteLine);
    }

    private static List<Element> Owned(Document document, TakeoffOptions options) =>
        new FilteredElementCollector(document).WhereElementIsNotElementType()
            .Where(element => SpaceMaterializer.Comments(element)
                ?.StartsWith($"{options.Marker}|spaces|", StringComparison.Ordinal) == true)
            .ToList();

    private static List<ModelCurve> BoundaryLines(Document document, TakeoffOptions options)
    {
        return new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_MEPSpaceSeparationLines)
            .WhereElementIsNotElementType().ToElements().Cast<ModelCurve>().ToList();
    }

    private static RoomResult Room(string id, List<double[]> polygon, params List<double[]>[] holes) => new() {
        Id = id,
        RawSqft = Math.Abs(Area(polygon)) - holes.Sum(hole => Math.Abs(Area(hole))),
        LabelX = polygon.Average(point => point[0]),
        LabelY = polygon.Average(point => point[1]),
        MeanCeilingFt = 10,
        Polygon = polygon,
        Holes = holes.ToList(),
    };

    private static List<double[]> Polygon(double x0, double y0, double x1, double y1) =>
        [new[] { x0, y0 }, new[] { x1, y0 }, new[] { x1, y1 }, new[] { x0, y1 }];

    private static List<double[]> SelfTouchingPolygon() => [
        new[] { 70d, 5 }, new[] { 70d, 0 }, new[] { 75d, 0 }, new[] { 75d, 5 },
        new[] { 70d, 5 }, new[] { 70d, 10 }, new[] { 65d, 10 }, new[] { 65d, 5 },
    ];

    private static double Area(IReadOnlyList<double[]> polygon) => polygon.Select((point, index) => {
        var next = polygon[(index + 1) % polygon.Count];
        return point[0] * next[1] - next[0] * point[1];
    }).Sum() / 2;

    private static string BoundaryKey(BoundaryCurve line)
    {
        bool forward = line.X1 < line.X2 || line.X1 == line.X2 && line.Y1 <= line.Y2;
        return forward
            ? $"{line.X1:G},{line.Y1:G}|{line.X2:G},{line.Y2:G}"
            : $"{line.X2:G},{line.Y2:G}|{line.X1:G},{line.Y1:G}";
    }

    private static double SharedAngle(RoomResult first, RoomResult second)
    {
        var secondEdges = Enumerable.Range(0, second.Polygon.Count).ToDictionary(index =>
            BoundaryKey(new BoundaryCurve(
                second.Polygon[index][0], second.Polygon[index][1],
                second.Polygon[(index + 1) % second.Polygon.Count][0],
                second.Polygon[(index + 1) % second.Polygon.Count][1])));
        var shared = Enumerable.Range(0, first.Polygon.Count).Select(index =>
                new BoundaryCurve(
                    first.Polygon[index][0], first.Polygon[index][1],
                    first.Polygon[(index + 1) % first.Polygon.Count][0],
                    first.Polygon[(index + 1) % first.Polygon.Count][1]))
            .Where(edge => secondEdges.ContainsKey(BoundaryKey(edge)))
            .OrderByDescending(edge => Math.Sqrt(
                Math.Pow(edge.X2 - edge.X1, 2) + Math.Pow(edge.Y2 - edge.Y1, 2)))
            .First();
        double angle = Math.Atan2(shared.Y2 - shared.Y1, shared.X2 - shared.X1) * 180 / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle <= -90) angle += 180;
        return angle;
    }

    private static double NetworkArea(IReadOnlyList<BoundaryCurve> lines)
    {
        var unused = lines.ToList();
        var first = unused[0];
        unused.RemoveAt(0);
        var points = new List<(double X, double Y)> { (first.X1, first.Y1), (first.X2, first.Y2) };
        while (unused.Count > 0)
        {
            var current = points[points.Count - 1];
            int index = unused.FindIndex(line =>
                Close(current, (line.X1, line.Y1)) || Close(current, (line.X2, line.Y2)));
            Assert.That(index, Is.GreaterThanOrEqualTo(0), "boundary network must remain connected");
            var next = unused[index];
            unused.RemoveAt(index);
            points.Add(Close(current, (next.X1, next.Y1))
                ? (next.X2, next.Y2)
                : (next.X1, next.Y1));
        }
        return Math.Abs(points.Zip(points.Skip(1), (a, b) => a.X * b.Y - b.X * a.Y).Sum() / 2);

        static bool Close((double X, double Y) a, (double X, double Y) b) =>
            Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y) < 1e-5;
    }
}
