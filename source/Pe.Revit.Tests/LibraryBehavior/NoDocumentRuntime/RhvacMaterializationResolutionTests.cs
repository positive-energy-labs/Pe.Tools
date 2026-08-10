using Newtonsoft.Json;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

public sealed class RhvacMaterializationResolutionTests
{
    [Test]
    public void Revit_materialization_resolutions_match_core_takeoff()
    {
        var fixtureDir = RhvacEvalTests.FindFixtureDir();
        var takeoffDir = Path.Combine(fixtureDir, "takeoff");
        var sidecar = Path.GetFullPath(Path.Combine(
            fixtureDir, "..", "fixtures", "project-a-main-four-verbs.json"));
        const string levelName = "Level 1/Main Level";

        var core = TakeoffTsv.ParseTsvDirectory(takeoffDir, sidecar);
        var materialization = RoomTakeoff.LoadMaterializationResult(takeoffDir, levelName, sidecar);
        var expected = core.Levels.Single(level => level.LevelName == levelName).Rooms.Select(room => new {
            room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
            Polygon = room.Outer, room.Holes, room.Flags, room.Label, room.SplitFrom, room.MergedFrom,
        });
        var actual = materialization.Takeoff.Rooms.Select(room => new {
            room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
            room.Polygon, room.Holes, room.Flags,
            Label = new[] { room.LabelX, room.LabelY }, room.SplitFrom, room.MergedFrom,
        });
        var expectedResidues = core.Levels.Single(level => level.LevelName == levelName).Residues
            .Select(residue => new {
                residue.Id, residue.Reason, residue.RawSqft, residue.MeanCeilingFt,
                Polygon = residue.Outer, residue.Holes, residue.Label,
            });
        var actualResidues = materialization.Takeoff.Residues.Select(residue => new {
            residue.Id, residue.Reason, residue.RawSqft, residue.MeanCeilingFt,
            residue.Polygon, residue.Holes, Label = new[] { residue.LabelX, residue.LabelY },
        });

        Assert.Multiple(() => {
            Assert.That((materialization.Applied, materialization.Remapped, materialization.Orphaned),
                Is.EqualTo((4, 0, 0)));
            Assert.That((materialization.Applied, materialization.Remapped, materialization.Orphaned),
                Is.EqualTo((core.Applied, core.Remapped, core.Orphaned)));
            Assert.That(JsonConvert.SerializeObject(actual), Is.EqualTo(JsonConvert.SerializeObject(expected)));
            Assert.That(JsonConvert.SerializeObject(actualResidues),
                Is.EqualTo(JsonConvert.SerializeObject(expectedResidues)));
            Assert.That(materialization.Takeoff.Rooms, Has.Count.EqualTo(81));
            Assert.That(materialization.Takeoff.Residues, Has.Count.EqualTo(3));
            Assert.That(materialization.Takeoff.Rooms.Select(room => room.Id),
                Does.Contain("R07.a").And.Contain("R07.b")
                    .And.Not.Contain("R06").And.Not.Contain("R07").And.Not.Contain("R09"));
            Assert.That(SpaceMaterializer.SpaceComments(
                    "owned", materialization.Takeoff.Rooms.Single(room => room.Id == "R07.a")),
                Is.EqualTo("owned|R07.a\npe-takeoff: splitFrom=R07"));
            Assert.That(SpaceMaterializer.SpaceComments(
                    "owned", materialization.Takeoff.Rooms.Single(room => room.Id == "R13")),
                Is.EqualTo("owned|R13\npe-takeoff: low-evidence-boundary, unregularized" +
                    "\npe-takeoff: mergedFrom=R09"));
            Assert.That(SpaceMaterializer.SpaceComments(
                    "owned", materialization.Takeoff.Rooms.Single(room => room.Id == "R03")),
                Is.EqualTo("owned|R03\npe-takeoff: open-plan-merge, ruled-seam"));
        });
    }
}
