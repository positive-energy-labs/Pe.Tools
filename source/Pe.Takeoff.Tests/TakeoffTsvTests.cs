using NetTopologySuite.Coverage;
using NetTopologySuite.Geometries;
using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class TakeoffTsvTests
{
    [Test]
    public void Parse_preserves_polygon_vertices_verbatim()
    {
        var tsv = string.Join("\n", new[] {
            "META\tlevel\tL1",
            "META\telev\t0.000000",
            "META\trooms\t1",
            "ROOM\tR01\t3.0\t8.0\t0.5\t0.5\t9.00",
            "POLY\tR01\touter\t0;0|2;0|2;1|1;1|1;2|0;2",
        });

        var level = TakeoffTsv.ParseTsv(tsv);

        Assert.That(level.Rooms.Single().Outer, Is.EqualTo(new[] {
            new[] { 0d, 0d }, new[] { 2d, 0d }, new[] { 2d, 1d },
            new[] { 1d, 1d }, new[] { 1d, 2d }, new[] { 0d, 2d },
        }));
    }

    [Test]
    public void Parse_rejects_topology_corruption_and_boundary_labels()
    {
        string Tsv(string outer, string label = "1.0\t1.0", string? hole = null, string rawSqft = "100") => string.Join("\n", new[] {
            "META\tlevel\tL1",
            "META\telev\t0",
            "META\trooms\t1",
            $"ROOM\tR01\t{rawSqft}\t40\t{label}\t9",
            $"POLY\tR01\touter\t{outer}",
            hole == null ? "" : $"POLY\tR01\thole\t{hole}",
        });

        Assert.Multiple(() => {
            Assert.Throws<InvalidDataException>(() => TakeoffTsv.ParseTsv(
                Tsv("0;0|5;0|0;4|4;4")), "self-crossing outer");
            Assert.Throws<InvalidDataException>(() => TakeoffTsv.ParseTsv(
                Tsv("0;0|10;0|10;10|0;10", hole: "20;20|20;21|21;21|21;20")),
                "hole outside shell");
            Assert.Throws<InvalidDataException>(() => TakeoffTsv.ParseTsv(
                Tsv("0;0|10;0|10;10|0;10", "10.0\t5.0")), "label on boundary");
            Assert.Throws<InvalidDataException>(() => TakeoffTsv.ParseTsv(
                Tsv("0;0|10;0|10;10|0;10", rawSqft: "10000")), "gross area corruption");
        });
    }

    [Test]
    public void Room_disposition_column_round_trips_and_absence_stays_unknown()
    {
        string Line(string tail) => string.Join("\n", new[] {
            "META\tlevel\tL1",
            "META\telev\t0",
            "META\trooms\t1",
            $"ROOM\tR01\t100\t40\t1.0\t1.0\t9{tail}",
            "POLY\tR01\touter\t0;0|10;0|10;10|0;10",
        });

        Assert.Multiple(() => {
            // 8-column ROOM: persisted disposition surfaces on the shape.
            Assert.That(TakeoffTsv.ParseTsv(Line("\taccepted")).Rooms.Single().Disposition,
                Is.EqualTo("accepted"));
            // 7-column ROOM (pre-column package / raw detector output): unknown, never accepted.
            Assert.That(TakeoffTsv.ParseTsv(Line("")).Rooms.Single().Disposition, Is.Null);
            Assert.Throws<InvalidDataException>(() => TakeoffTsv.ParseTsv(Line("\tmaybe")),
                "unknown disposition token must fail fast");
        });

        // The promoted writer emits the column; the raw writer must not.
        var result = new TakeoffResult {
            LevelName = "L1",
            Rooms = {
                new RoomResult {
                    Id = "R01", RawSqft = 100, PerimeterFt = 40, LabelX = 1, LabelY = 1,
                    MeanCeilingFt = 9,
                    Polygon = { new[] { 0d, 0d }, new[] { 10d, 0d }, new[] { 10d, 10d }, new[] { 0d, 10d } },
                },
            },
        };
        Assert.That(result.ToTsv(), Does.Contain("ROOM\tR01\t100.0\t40.0")
            .And.Not.Contain("\taccepted"));
        result.DispositionsResolved = true;
        Assert.That(result.ToTsv(), Does.Contain("\t9.00\taccepted"));
    }

    [Test]
    public void Checked_in_ProjectA_takeoffs_are_valid_shared_coverages()
    {
        var factory = new GeometryFactory(new PrecisionModel(1_000_000));
        var levels = TakeoffTsv.ParseTsvDirectory(Path.Combine(RhvacEvalTests.FindFixtureDir(), "takeoff"));
        foreach (var level in levels)
        {
            LinearRing Ring(IReadOnlyList<double[]> points) => factory.CreateLinearRing(
                points.Append(points[0]).Select(point => new Coordinate(point[0], point[1])).ToArray());
            Geometry[] coverage = level.Rooms.Select(room => factory.CreatePolygon(
                Ring(room.Outer), room.Holes.Select(Ring).ToArray())).Cast<Geometry>().ToArray();
            Assert.That(CoverageValidator.IsValid(coverage), Is.True, level.LevelName);
        }
    }
}
