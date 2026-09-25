using System.Numerics;
using Autodesk.Revit.DB;
using NUnit.Framework;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     Chadds Ford's IFC link has 0 Floors: its slabs are nameless Generic Models (IfcBuildingElementProxy), so a
///     category-only height role left the live RoomHeights probe with no floor anywhere on the file (every Main
///     Level face held no-floor). The live read under ML09 (.artifacts/runs/rails/w13/rays.json): proxy slab top at
///     z -0.0, and in the island closet a Return Air duct top at 0.25; w15/no-ceiling-rays.json: a vaulted proxy roof
///     sloped 9.5 to 33.7 degrees overhead and sunken proxy slabs to -1.19. The columns below are those reads through
///     the probe's own role predicates; the Bvh ray itself needs RevitAPI loaded.
/// </summary>
public sealed class NoFloorTests {
    private static readonly double[] Levels = [0.0, 12.1];

    [TestCase(0.0, TestName = "Proxy slab at the level is the floor, not the duct or table over it")]
    [TestCase(-1.0, TestName = "Sunken proxy slab 1 ft under the level is the floor")]
    public void Proxy_column(double slabZ) {
        var proxy = HeightRoles.Of((long)BuiltInCategory.OST_GenericModel, false);
        (string Name, HeightRole Role, Tri Tri)[] column = [
            ("vault underside", proxy, Sloped(15.0, 33.7)),
            ("table top", HeightRoles.Of((long)BuiltInCategory.OST_Furniture, false), Flat(2.5)),
            ("return air duct", HeightRoles.Of((long)BuiltInCategory.OST_DuctCurves, false), Flat(0.25)),
            ("slab top", proxy, Flat(slabZ)),
        ];
        const double knee = 3.5;
        var floor = column.Where(c => Z(c.Tri) <= knee && HeightRoles.Floor(c.Role, c.Tri, Levels)).MaxBy(c => Z(c.Tri));
        var ceiling = column.Where(c => Z(c.Tri) > knee && HeightRoles.Overhead(c.Role)).MinBy(c => Z(c.Tri));
        Assert.Multiple(() => {
            Assert.That(floor.Name, Is.EqualTo("slab top"));
            Assert.That(ceiling.Name, Is.EqualTo("vault underside"), "a sloped roof underside is the ceiling");
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_DuctCurves, false), Is.EqualTo(HeightRole.None));
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_Floors, false), Is.EqualTo(HeightRole.Floor | HeightRole.Overhead));
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_GenericModel, true), Is.EqualTo(HeightRole.None), "a DWG import");
        });
    }

    [TestCase(-1.6)]
    [TestCase(0.6)]
    public void Flat_proxy_outside_the_level_band_is_not_a_floor(double z) =>
        Assert.That(HeightRoles.Floor(HeightRole.ByGeometry, Flat(z), Levels), Is.False);

    [Test]
    public void Steep_face_at_the_level_is_not_a_floor() {
        var ramp = new Tri { A = new Vector3(0, 0, 0), B = new Vector3(10, 0, 1), C = new Vector3(0, 10, 0) };
        Assert.That(HeightRoles.Floor(HeightRole.ByGeometry, ramp, Levels), Is.False);
    }

    // A roof plane rising along x through z at its centroid.
    private static Tri Sloped(double z, double degrees) {
        var rise = (float)(10 * Math.Tan(degrees * Math.PI / 180.0));
        var f = (float)z - (rise / 3f);
        return new Tri { A = new Vector3(0, 0, f), B = new Vector3(0, 10, f), C = new Vector3(10, 0, f + rise) };
    }

    // Wound down on purpose: facing is not read, so a slab reads the same either way up.
    private static Tri Flat(double z) {
        var f = (float)z;
        return new Tri { A = new Vector3(0, 0, f), B = new Vector3(0, 10, f), C = new Vector3(10, 0, f) };
    }

    private static double Z(Tri t) => (t.A.Z + t.B.Z + t.C.Z) / 3.0;
}
