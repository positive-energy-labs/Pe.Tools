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

        var actual = SpaceBoundaryNetwork.Build(rooms)
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

        var rooms = new[] { Room("A", stairSteppedTrapezoid) };
        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => false);
        var actual = SpaceBoundaryNetwork.Build(rooms);

        Assert.Multiple(() => {
            Assert.That(actual, Has.Count.EqualTo(4));
            Assert.That(actual, Has.None.Matches<BoundaryCurve>(curve => curve.IsArc));
            Assert.That(NetworkArea(actual), Is.EqualTo(Math.Abs(Area(stairSteppedTrapezoid))).Within(1e-5));
        });
    }

    [Test]
    public void Boundary_network_preserves_shared_dogleg_when_straightening_exceeds_area_contract()
    {
        var rooms = new[] {
            Room("A", [new[] { 0d, 0 }, new[] { 5d, 0 }, new[] { 5d, 2 }, new[] { 6d, 2 },
                new[] { 6d, 8 }, new[] { 5d, 8 }, new[] { 5d, 10 }, new[] { 0d, 10 }]),
            Room("B", [new[] { 5d, 0 }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 5d, 10 },
                new[] { 5d, 8 }, new[] { 6d, 8 }, new[] { 6d, 2 }, new[] { 5d, 2 }]),
        };

        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => false);
        var actual = SpaceBoundaryNetwork.Build(rooms);

        Assert.Multiple(() => {
            Assert.That(actual, Has.One.Matches<BoundaryCurve>(line =>
                Math.Abs(line.X1 - 6) < 1e-6 && Math.Abs(line.X2 - 6) < 1e-6
                && Math.Abs(line.Y1 - line.Y2) > 5.9));
            Assert.That(actual, Has.None.Matches<BoundaryCurve>(line =>
                Math.Abs(line.X1 - 5) < 1e-6 && Math.Abs(line.X2 - 5) < 1e-6
                && Math.Abs(line.Y1 - line.Y2) > 9.9));
            Assert.That(rooms, Has.All.Matches<RoomResult>(room =>
                room.Flags.Contains("unregularized", StringComparer.Ordinal)));
        });
    }

    // An unsupported diagonal seam (open-plan equidistance artifact) must emit as axis-aligned
    // segments — an engineer rules an on-axis split, never a diagonal chord.
    [Test]
    public void Free_seams_emit_axis_aligned_connectors_not_diagonals()
    {
        var rooms = DiagonalSeamRooms();
        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => false, TestContext.WriteLine);
        var actual = SpaceBoundaryNetwork.Build(rooms);

        Assert.Multiple(() => {
            Assert.That(actual, Has.All.Matches<BoundaryCurve>(curve =>
                Math.Abs(curve.X1 - curve.X2) < 1e-6 || Math.Abs(curve.Y1 - curve.Y2) < 1e-6));
            Assert.That(rooms.SelectMany(room => room.Flags), Does.Contain("ruled-seam"));
        });
    }

    // The same seam OVER wall ink is real off-axis geometry: the engine must not reshape it —
    // it stays raster-faithful and both owning rooms are flagged for the human/Pea loop.
    [Test]
    public void Supported_offaxis_walls_stay_raw_and_flag_rooms_unregularized()
    {
        var rooms = DiagonalSeamRooms();
        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => true, TestContext.WriteLine);

        Assert.That(rooms.SelectMany(room => room.Flags), Does.Contain("unregularized"));
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
            var unresolved = Room("R03", Polygon(20, 0, 30, 10));
            unresolved.Flags.Add("unregularized");
            var result = new TakeoffResult {
                LevelName = level.Name,
                LevelElevation = level.ProjectElevation,
                Rooms = {
                    Room("R01", Polygon(0, 0, 10, 10), Polygon(2, 2, 4, 4)),
                    Room("R02", Polygon(10, 0, 20, 10)),
                    unresolved,
                    Room("R04", Polygon(40, 0, 60, 1)),
                },
                Residues = {
                    new ResidueResult {
                        Id = "X01", Reason = ResidueReason.Rejected, RawSqft = 100,
                        LabelX = 35, LabelY = 5, MeanCeilingFt = 10,
                        Polygon = Polygon(30, 0, 40, 10),
                    },
                },
                TotalSqft = 316,
            };
            var options = new TakeoffOptions { Marker = "PE-TEST-TAKEOFF" };

            using var transaction = new Transaction(document, "Prove takeoff Space materialization");
            transaction.Start();

            var first = SpaceMaterializer.Replace(document, level, phase, result, options, TestContext.WriteLine);
            document.Regenerate();
            AssertMaterialization(document, first, options, level, phase);

            var second = SpaceMaterializer.Replace(document, level, phase, result, options, TestContext.WriteLine);
            document.Regenerate();
            Assert.That(second.Spaces, Has.Count.EqualTo(2));
            Assert.That(second.Spaces, Has.None.Matches<ElementId>(id => first.Spaces.Contains(id)));
            AssertMaterialization(document, second, options, level, phase);

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

            using var transaction = new Transaction(document, "Prove project-a materialization census");
            transaction.Start();
            var materialized = SpaceMaterializer.Replace(
                document, level, phase, result, options, TestContext.WriteLine);
            document.Regenerate();

            TestContext.Progress.WriteLine(
                $"[project-a-census] spaces={materialized.Spaces.Count} " +
                $"filledRegions={materialized.FilledRegions} lineFallbacks={materialized.LineFallbacks} " +
                $"filledRegionFailures={materialized.FilledRegionFailures} rooms={materialized.Rooms} " +
                $"residues={materialized.Residues} defectors={materialized.Defectors}");
            Assert.Multiple(() => {
                Assert.That(materialized.AccountingHolds, Is.True);
                Assert.That(materialized.DeletedWithoutReplacement, Is.Zero);
                Assert.That((materialized.Spaces.Count, materialized.FilledRegions, materialized.LineFallbacks,
                        materialized.FilledRegionFailures, materialized.Rooms, materialized.Residues,
                        materialized.Defectors),
                    Is.EqualTo((10, 43, 31, 31, 72, 3, 9)));
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
        Document document, SpaceMaterializationResult result, TakeoffOptions options, Level level, Phase phase)
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
                Is.EqualTo((2, 3, 0, 0, 3, 1, 1, 0)));
            Assert.That(spaces, Has.Count.EqualTo(2));
            Assert.That(spaces[0].Area, Is.EqualTo(96).Within(0.01));
            Assert.That(spaces[1].Area, Is.EqualTo(100).Within(0.01));
            Assert.That(spaces.Select(space => space.Number),
                Is.EquivalentTo(new[] { "R01", "R02" }));
            Assert.That(spaces.All(space => space.LevelId.Value() == level.Id.Value()
                                            && space.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)
                                                ?.AsElementId().Value() == phase.Id.Value()), Is.True);
            Assert.That(spaces[0].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(2));
            Assert.That(spaces[1].GetBoundarySegments(new SpatialElementBoundaryOptions())?.Count, Is.EqualTo(1));
            var firstPoint = ((LocationPoint)spaces[0].Location).Point;
            var secondPoint = ((LocationPoint)spaces[1].Location).Point;
            Assert.That(Math.Abs(firstPoint.X - 5) + Math.Abs(firstPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(Math.Abs(secondPoint.X - 15) + Math.Abs(secondPoint.Y - 5), Is.LessThan(0.01));
            Assert.That(owned.Count(element => element is Space), Is.EqualTo(2));
            Assert.That(filledRegions, Has.Count.EqualTo(3));
            Assert.That(filledRegions.Select(SpaceMaterializer.Comments),
                Has.Some.Contains("|R03\npe-takeoff: unregularized"));
            Assert.That(filledRegions.Select(SpaceMaterializer.Comments),
                Has.Some.Contains("|R04\npe-takeoff: shape-defect=sliver"));
            Assert.That(filledRegions.Select(SpaceMaterializer.Comments),
                Has.Some.Contains("|X01\npe-takeoff: residue=rejected"));
            Assert.That(BoundaryLines(document, options), Has.Count.EqualTo(13));
            Assert.That(BoundaryLines(document, options), Has.None.Matches<ModelCurve>(line => {
                var curve = line.GeometryCurve;
                return curve.GetEndPoint(0).X > 20.01 && curve.GetEndPoint(0).X < 29.99
                       || curve.GetEndPoint(1).X > 20.01 && curve.GetEndPoint(1).X < 29.99;
            }));
        });
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
