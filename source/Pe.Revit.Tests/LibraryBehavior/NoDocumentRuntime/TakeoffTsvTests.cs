using Newtonsoft.Json;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

public sealed class TakeoffTsvTests
{
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
    public void Parse_preserves_polygon_vertices_verbatim()
    {
        var tsv = string.Join("\n", new[] {
            "META\tlevel\tL1",
            "META\telev\t0.000000",
            "META\trooms\t1",
            "ROOM\tR01\t3.0\t8.0\t1.0\t1.0\t9.00",
            "POLY\tR01\touter\t0;0|2;0|2;1|1;1|1;2|0;2",
        });

        var level = TakeoffTsv.ParseTsv(tsv);

        Assert.That(level.Rooms.Single().Outer, Is.EqualTo(new[] {
            new[] { 0d, 0d }, new[] { 2d, 0d }, new[] { 2d, 1d },
            new[] { 1d, 1d }, new[] { 1d, 2d }, new[] { 0d, 2d },
        }));
    }

    [Test]
    public void Split_resolution_changes_takeoff_output_deterministically_and_idempotently()
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
            File.WriteAllText(Path.Combine(takeoffDir, "rooms_L1.native.tsv"),
                tsv.Replace("META\trooms", "META\tsource\tnative\nMETA\trooms"));
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

            var resolved = TakeoffTsv.ParseTsvDirectory(takeoffDir).Levels;
            var reapplied = TakeoffResolutions.ApplyResolutions(resolved, sidecar).Levels;

            Assert.Multiple(() => {
                Assert.That(resolved.Single().Rooms.Select(room => room.Id),
                    Is.EqualTo(new[] { "R01.a", "R01.b", "R02" }));
                Assert.That(resolved.Single().Rooms.Select(room => room.RawSqft),
                    Is.EqualTo(new[] { 750.0, 450.0, 100.0 }));
                Assert.That(resolved.Single().Rooms.Take(2).Select(room => room.SplitFrom),
                    Is.All.EqualTo("R01"));
                Assert.That(resolved.Single().Rooms.SelectMany(room => room.Flags), Is.Empty);
                Assert.That(JsonConvert.SerializeObject(reapplied),
                    Is.EqualTo(JsonConvert.SerializeObject(resolved)), "reapply must be idempotent");
                Assert.That(JsonConvert.SerializeObject(TakeoffTsv.ParseTsvDirectory(takeoffDir).Levels),
                    Is.EqualTo(JsonConvert.SerializeObject(resolved)), "fresh parse must be deterministic");
            });

            File.WriteAllText(sidecar, File.ReadAllText(sidecar).Replace("\"version\": 1", "\"version\": 2"));
            Assert.That(
                TakeoffTsv.ParseTsvDirectory(takeoffDir).Levels.Single().Rooms.Select(room => room.Id),
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
            var before = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.BeforeTsv) }, sidecarPath);
            var result = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.AfterTsv) }, sidecarPath);

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
            var before = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.BeforeTsv) }, sidecarPath);
            var after = TakeoffResolutions.ApplyResolutions(
                new[] { TakeoffTsv.ParseTsv(fixture.AfterTsv) }, sidecarPath);

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

        var result = TakeoffTsv.ParseTsvDirectory(takeoffDir, sidecar);
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

            var result = TakeoffResolutions.ApplyResolutions(new[] { level }, sidecar);

            Assert.That((result.Applied, result.Remapped, result.Orphaned), Is.EqualTo((2, 0, 0)));
            Assert.That(result.Levels.Single().Rooms.Select(room => (room.Id, room.RawSqft)),
                Is.EqualTo(new[] { ("R03", 300.0) }));
        }
        finally
        {
            File.Delete(sidecar);
        }
    }
}
