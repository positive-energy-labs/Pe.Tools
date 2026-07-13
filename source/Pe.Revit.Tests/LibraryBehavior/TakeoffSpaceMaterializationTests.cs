using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior;

public sealed class TakeoffSpaceMaterializationTests
{
    [Test]
    public void Boundary_network_unions_shared_and_split_edges_once()
    {
        var rooms = new[] {
            Room("A", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4)),
            Room("B", Polygon(10, 0, 20, 5)),
            Room("C", Polygon(10, 5, 20, 10)),
        };

        var actual = SpaceBoundaryNetwork.Build(rooms, 1, 0)
            .Select(line => $"{line.X1},{line.Y1}->{line.X2},{line.Y2}")
            .ToArray();

        Assert.That(actual, Is.EquivalentTo(new[] {
            "0,0->20,0", "0,10->20,10", "0,0->0,10", "10,0->10,10", "20,0->20,10",
            "10,5->20,5", "2,2->4,2", "2,4->4,4", "2,2->2,4", "4,2->4,4",
        }));
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

        var actual = SpaceBoundaryNetwork.Build([Room("A", stairSteppedTrapezoid)], 1, 1);

        Assert.Multiple(() => {
            Assert.That(actual, Has.Count.EqualTo(4));
            Assert.That(actual, Has.None.Matches<BoundaryCurve>(curve => curve.IsArc));
            Assert.That(NetworkArea(actual), Is.EqualTo(Math.Abs(Area(stairSteppedTrapezoid))).Within(1e-5));
        });
    }

    [Test]
    public void Boundary_network_straightens_shared_wall_without_an_area_preserving_dogleg()
    {
        var rooms = new[] {
            Room("A", [new[] { 0d, 0 }, new[] { 5d, 0 }, new[] { 5d, 2 }, new[] { 6d, 2 },
                new[] { 6d, 8 }, new[] { 5d, 8 }, new[] { 5d, 10 }, new[] { 0d, 10 }]),
            Room("B", [new[] { 5d, 0 }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 5d, 10 },
                new[] { 5d, 8 }, new[] { 6d, 8 }, new[] { 6d, 2 }, new[] { 5d, 2 }]),
        };

        var actual = SpaceBoundaryNetwork.Build(rooms, 1, 1);

        Assert.That(actual, Has.One.Matches<BoundaryCurve>(line =>
            Math.Abs(line.X1 - 5) < 1e-6 && Math.Abs(line.X2 - 5) < 1e-6
            && Math.Abs(line.Y1 - line.Y2) > 9.9));
    }

    // An unsupported diagonal seam (open-plan equidistance artifact) must emit as axis-aligned
    // segments — an engineer rules an on-axis split, never a diagonal chord.
    [Test]
    public void Free_seams_emit_axis_aligned_connectors_not_diagonals()
    {
        var unresolved = new SortedSet<string>(StringComparer.Ordinal);
        var actual = SpaceBoundaryNetwork.Build(
            DiagonalSeamRooms(), 1, 1, inkNear: null, unresolved, TestContext.WriteLine);

        Assert.Multiple(() => {
            Assert.That(actual, Has.All.Matches<BoundaryCurve>(curve =>
                Math.Abs(curve.X1 - curve.X2) < 1e-6 || Math.Abs(curve.Y1 - curve.Y2) < 1e-6));
            Assert.That(unresolved, Is.Empty);
        });
    }

    // The same seam OVER wall ink is real off-axis geometry: the engine must not reshape it —
    // it stays raster-faithful and both owning rooms are flagged for the human/Pea loop.
    [Test]
    public void Supported_offaxis_walls_stay_raw_and_flag_rooms_unresolved()
    {
        var unresolved = new SortedSet<string>(StringComparer.Ordinal);
        SpaceBoundaryNetwork.Build(
            DiagonalSeamRooms(), 1, 1, inkNear: (_, _) => true, unresolved, TestContext.WriteLine);

        Assert.That(unresolved, Is.EquivalentTo(new[] { "A", "B" }));
    }

    // 100x60 rectangle split by a seam that staircases (50,0)->(58,8) then runs straight up x=58.
    private static RoomResult[] DiagonalSeamRooms()
    {
        var seam = new List<double[]>();
        for (int i = 0; i < 8; i++)
        {
            seam.Add(new[] { 50d + i, 0d + i });
            seam.Add(new[] { 50d + i, 1d + i });
        }
        seam.Add(new[] { 58d, 8d });
        var a = new List<double[]> { new[] { 0d, 0 }, new[] { 50d, 0 } };
        a.AddRange(seam.Skip(1));
        a.AddRange([new[] { 58d, 60 }, new[] { 0d, 60 }]);
        var b = new List<double[]> { new[] { 50d, 0 }, new[] { 100d, 0 }, new[] { 100d, 60 }, new[] { 58d, 60 }, new[] { 58d, 8 } };
        b.AddRange(seam.Skip(1).Reverse().Skip(1));
        return [Room("A", a), Room("B", b)];
    }

    [Test]
    public void Spaces_replace_idempotently_and_cleanup_completely(UIApplication uiApplication)
    {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try
        {
            var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
                .OrderBy(item => item.Elevation).First();
            var phase = document.Phases.Cast<Phase>().Last();
            var result = new TakeoffResult {
                LevelName = level.Name,
                LevelElevation = level.ProjectElevation,
                Rooms = {
                    Room("R01", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4)),
                    Room("R02", Polygon(10, 0, 20, 10)),
                },
                TotalSqft = 196,
            };
            var options = new TakeoffOptions { Marker = "PE-TEST-TAKEOFF" };

            using var transaction = new Transaction(document, "Prove takeoff Space materialization");
            transaction.Start();

            var first = SpaceMaterializer.Replace(document, level, phase, result, options, TestContext.WriteLine);
            document.Regenerate();
            AssertSpaces(document, first, result, options, level, phase);

            var second = SpaceMaterializer.Replace(document, level, phase, result, options, TestContext.WriteLine);
            document.Regenerate();
            Assert.That(second, Has.Count.EqualTo(2));
            Assert.That(second, Has.None.Matches<ElementId>(id => first.Contains(id)));
            AssertSpaces(document, second, result, options, level, phase);

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

    private static void AssertSpaces(
        Document document, IReadOnlyList<ElementId> ids, TakeoffResult result, TakeoffOptions options,
        Level level, Phase phase)
    {
        var spaces = ids.Select(id => document.GetElement(id)).Cast<Space>().OrderBy(space => space.Number).ToList();
        Assert.Multiple(() => {
            Assert.That(spaces, Has.Count.EqualTo(2));
            Assert.That(spaces[0].Area, Is.EqualTo(96).Within(0.01));
            Assert.That(spaces[1].Area, Is.EqualTo(100).Within(0.01));
            Assert.That(spaces.All(space => space.LevelId.Value == level.Id.Value
                                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)
                                                ?.AsElementId().Value == phase.Id.Value), Is.True);
            Assert.That(spaces[0].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(2));
            Assert.That(spaces[1].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(1));
            var firstPoint = ((LocationPoint)spaces[0].Location).Point;
            var secondPoint = ((LocationPoint)spaces[1].Location).Point;
            Assert.That(Math.Abs(firstPoint.X - 5) + Math.Abs(firstPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(Math.Abs(secondPoint.X - 15) + Math.Abs(secondPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(Owned(document, options).Count(element => element is Space), Is.EqualTo(2));
            Assert.That(BoundaryLines(document, options), Has.Count.EqualTo(9));
        });
    }

    private static List<Element> Owned(Document document, TakeoffOptions options) =>
        new FilteredElementCollector(document).WhereElementIsNotElementType()
            .Where(element => element.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString()
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

    private static double Area(IReadOnlyList<double[]> polygon) => polygon.Select((point, index) => {
        var next = polygon[(index + 1) % polygon.Count];
        return point[0] * next[1] - next[0] * point[1];
    }).Sum() / 2;

    private static double NetworkArea(IReadOnlyList<BoundaryCurve> lines)
    {
        var unused = lines.ToList();
        var first = unused[0];
        unused.RemoveAt(0);
        var points = new List<(double X, double Y)> { (first.X1, first.Y1), (first.X2, first.Y2) };
        while (unused.Count > 0)
        {
            var current = points[^1];
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
