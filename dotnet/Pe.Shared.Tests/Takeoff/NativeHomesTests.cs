using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Takeoff.Tests;

public sealed class NativeHomesTests
{
    [Test]
    public void The_declared_region_home_is_the_record_owner()
    {
        Assert.That(NativeHomes.RoomsRegions, Is.EqualTo("owner-blob:" + RoomsRegionRecord.Owner.Guid.ToString("D")));
    }
}
