using Pe.Revit.Takeoff.Rhvac;

using NUnit.Framework;

namespace Pe.Takeoff.Tests;

public sealed class RhvacRoomShapeTests
{
    private static readonly RhvacAssembly FloorAssembly = new("22C-10pm", 1.108);
    private static readonly RhvacAssembly RoofAssembly = new("18B1-59c", 0.02);
    private static readonly RhvacAssembly WallAssembly = new("Belmont Wall 1", 0.038);
    private static readonly RhvacAssembly WindowAssembly = new("Belmont Window", 0.37);
    private static readonly RhvacAssembly DoorAssembly = new("11D", 0.39);

    [Test]
    public void Full_room_is_valid_and_openings_belong_to_walls()
    {
        var room = new RhvacRoom(74, "PE Revit import probe", 120, 8) {
            InternalLoads = new RhvacInternalLoads(People: 1, LightingWatts: 30),
        };
        room.Floors.Add(new RhvacFloor(FloorAssembly, 120, 44));
        room.Roofs.Add(new RhvacRoof(RoofAssembly, 120, 1.2));
        room.Walls.Add(new RhvacWall(WallAssembly, 12, 8, RhvacWallDirection.North));
        room.Walls.Add(new RhvacWall(WallAssembly, 10, 8, RhvacWallDirection.East));
        room.Walls.Add(new RhvacWall(WallAssembly, 12, 8, RhvacWallDirection.South));
        room.Walls.Add(new RhvacWall(WallAssembly, 10, 8, RhvacWallDirection.West));
        room.Walls[3].Windows.Add(new RhvacWindow(WindowAssembly, 4, 5, 0.23));
        room.Walls[2].Doors.Add(new RhvacDoor(DoorAssembly, 3, 6.666667));

        Assert.That(room.Validate(), Is.Empty);

        room.Walls[0].Windows.Add(new RhvacWindow(WindowAssembly, 20, 20, 0.23));
        Assert.That(
            room.Validate(),
            Has.One.Matches<RhvacRoomValidationIssue>(
                issue => issue.Path == "room.walls[0].openings"
            )
        );
    }

    [Test]
    public void Interior_room_without_exposure_is_valid()
    {
        // ~Half of real rooms (projectA) have no exterior walls, floors, or roofs at all.
        var room = new RhvacRoom(29, "Her Closet", 402, 11.5);
        Assert.That(room.Validate(), Is.Empty);
    }

    [Test]
    public void Slab_edge_only_floor_row_is_valid()
    {
        // Real data (project-a rooms 67-69): floor area 0 with a positive exposed perimeter.
        var room = new RhvacRoom(67, "Manager 161", 349, 10.5);
        room.Floors.Add(new RhvacFloor(FloorAssembly, 0, 78.833));
        Assert.That(room.Validate(), Is.Empty);

        room.Floors.Add(new RhvacFloor(FloorAssembly, 0, 0));
        Assert.That(
            room.Validate(),
            Has.One.Matches<RhvacRoomValidationIssue>(
                issue => issue.Path == "room.floors[1]"
            )
        );
    }

    [Test]
    public void Floor_exposure_can_be_partial_but_cannot_exceed_room_area()
    {
        var room = new RhvacRoom(110, "Robs Office 252", 491, 10);
        room.Floors.Add(new RhvacFloor(FloorAssembly, 170, 52));
        room.Floors.Add(new RhvacFloor(FloorAssembly, 308, 52));
        Assert.That(room.Validate(), Is.Empty); // 478 vs 491 = 2.65%, real project-a slack

        var partial = new RhvacRoom(110, "Robs Office 252", 491, 10);
        partial.Floors.Add(new RhvacFloor(FloorAssembly, 170, 52));
        Assert.That(partial.Validate(), Is.Empty);

        var drifted = new RhvacRoom(110, "Robs Office 252", 491, 10);
        drifted.Floors.Add(new RhvacFloor(FloorAssembly, 520, 52));
        Assert.That(
            drifted.Validate(),
            Has.One.Matches<RhvacRoomValidationIssue>(issue => issue.Path == "room.floors")
        );
    }
}
