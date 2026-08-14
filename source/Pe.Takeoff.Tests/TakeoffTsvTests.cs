using Newtonsoft.Json;
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
    public void V2_resolutions_survive_rank_reshuffle_by_geometric_anchor_without_silent_drops()
    {
        var fixturePath = Path.GetFullPath(Path.Combine(
            RhvacEvalTests.FindFixtureDir(), "..", "fixtures", "sidecar-anchor-remap.json"));
        var fixture = JsonConvert.DeserializeObject<AnchorRemapFixture>(File.ReadAllText(fixturePath))!;
        var sidecarPath = Path.GetTempFileName();
        try
        {
            File.WriteAllText(sidecarPath, JsonConvert.SerializeObject(fixture.Sidecar));
            var before = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.BeforeTsv) }, sidecarPath);
            var result = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.AfterTsv) }, sidecarPath);

            Assert.Multiple(() => {
                Assert.That((before.Applied, before.Remapped, before.Orphaned),
                    Is.EqualTo((2, 0, 1)));
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
                Assert.That(result.Applied + result.Remapped + result.Orphaned,
                    Is.EqualTo(fixture.Sidecar.Resolutions.Count));
            });
        }
        finally
        {
            File.Delete(sidecarPath);
        }
    }
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
        string RejectedRoomId
    );
    [Test]
    public void ProjectA_main_sidecar_round_trips_with_expected_rooms_and_areas()
    {
        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var takeoffDir = Path.Combine(fixtureDir, "takeoff");
        var sidecar = Path.GetFullPath(Path.Combine(
            fixtureDir, "..", "fixtures", "project-a-main-two-verbs.json"));

        var before = TakeoffTsv.ParseTsvDirectory(takeoffDir)
            .Levels.Single(level => level.LevelName == "Level 1/Main Level");
        var result = TakeoffTsv.ParseTsvDirectory(takeoffDir, sidecar);
        var main = result.Levels.Single(level => level.LevelName == "Level 1/Main Level");

        Assert.Multiple(() => {
            Assert.That((result.Applied, result.Remapped, result.Orphaned), Is.EqualTo((2, 0, 0)));
            Assert.That(main.Rooms, Has.Count.EqualTo(before.Rooms.Count - 1));
            Assert.That(main.Rooms.Select(room => room.Id), Does.Not.Contain("R77"));
            Assert.That(main.Residues.Single(residue =>
                residue.Reason == ResidueReason.Rejected && residue.Claimed).Id, Is.EqualTo("R77"));
            Assert.That(main.Rooms.Single(room => room.Id == "R04").RawSqft,
                Is.EqualTo(before.Rooms.Single(room => room.Id == "R04").RawSqft));
            Assert.That(main.Rooms.Single(room => room.Id == "R04").Flags,
                Does.Not.Contain("low-evidence-boundary"));
        });
    }

    [Test]
    public void Checked_in_ProjectA_takeoffs_are_valid_shared_coverages()
    {
        var factory = new GeometryFactory(new PrecisionModel(1_000_000));
        var levels = TakeoffTsv.ParseTsvDirectory(Path.Combine(RhvacEvalTests.FindFixtureDir(), "takeoff")).Levels;
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
