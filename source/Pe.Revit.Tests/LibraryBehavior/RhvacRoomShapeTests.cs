using Pe.Revit.Takeoff.Rhvac;

namespace Pe.Revit.Tests.LibraryBehavior;

public sealed class RhvacRoomShapeTests
{
    [Test]
    public void Belmont_probe_is_a_valid_room_and_openings_belong_to_walls()
    {
        var floorAssembly = new RhvacAssembly("22C-10pm", 1.108);
        var roofAssembly = new RhvacAssembly("18B1-59c", 0.02);
        var wallAssembly = new RhvacAssembly("Belmont Wall 1", 0.038);
        var windowAssembly = new RhvacAssembly("Belmont Window", 0.37);
        var doorAssembly = new RhvacAssembly("11D", 0.39);
        var room = new RhvacRoom(74, "PE Revit import probe", 120, 8) {
            SystemNumber = 1,
            ZoneNumber = 1,
            InternalLoads = new RhvacInternalLoads(People: 1, LightingWatts: 30),
        };
        room.Floors.Add(new RhvacFloor(floorAssembly, 12, 10, 44));
        room.Roofs.Add(new RhvacRoof(roofAssembly, 12, 10));
        room.Walls.Add(new RhvacWall(wallAssembly, 12, 8, RhvacWallDirection.North));
        room.Walls.Add(new RhvacWall(wallAssembly, 10, 8, RhvacWallDirection.East));
        room.Walls.Add(new RhvacWall(wallAssembly, 12, 8, RhvacWallDirection.South));
        room.Walls.Add(new RhvacWall(wallAssembly, 10, 8, RhvacWallDirection.West));
        room.Walls[3].Windows.Add(new RhvacWindow(windowAssembly, 4, 5, 0.23));
        room.Walls[2].Doors.Add(new RhvacDoor(doorAssembly, 3, 6.666667));

        Assert.That(room.Validate(), Is.Empty);

        room.Walls[0].Windows.Add(new RhvacWindow(windowAssembly, 20, 20, 0.23));
        Assert.That(
            room.Validate(),
            Has.One.Matches<RhvacRoomValidationIssue>(
                issue => issue.Path == "room.walls[0].openings"
            )
        );
    }
}
