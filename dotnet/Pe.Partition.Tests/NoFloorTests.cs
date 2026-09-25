using System.Numerics;
using Autodesk.Revit.DB;
using NUnit.Framework;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     Chadds Ford's IFC link has 0 Floors: its slabs are nameless Generic Models (IfcBuildingElementProxy), so a
///     category-only height role left the live RoomHeights probe with no floor anywhere on the file (every Main
///     Level face held no-floor). The live read under ML09 (.artifacts/runs/rails/w13/rays.json): proxy slab top at
///     z -0.0, proxy underside overhead at 11.5, and in the island closet a Return Air duct top at 0.25. The column
///     below is that read through the probe's own role predicates; the Bvh ray itself needs RevitAPI loaded.
/// </summary>
public sealed class NoFloorTests {
    private static readonly double[] Levels = [0.0, 12.1];

    [Test]
    public void Proxy_slab_is_the_floor_and_the_duct_over_it_is_not() {
        var proxy = HeightRoles.Of((long)BuiltInCategory.OST_GenericModel, false);
        (string Name, HeightRole Role, Tri Tri)[] column = [
            ("upper slab underside", proxy, Flat(11.5)),
            ("table top", HeightRoles.Of((long)BuiltInCategory.OST_Furniture, false), Flat(2.5)),
            ("return air duct", HeightRoles.Of((long)BuiltInCategory.OST_DuctCurves, false), Flat(0.25)),
            ("slab top", proxy, Flat(0.0)),
            ("slab underside", proxy, Flat(-1.0)),
        ];
        const double knee = 3.5;
        var floor = column.Where(c => Z(c.Tri) <= knee && HeightRoles.Floor(c.Role, c.Tri, Levels)).MaxBy(c => Z(c.Tri));
        var ceiling = column.Where(c => Z(c.Tri) > knee && HeightRoles.Overhead(c.Role, c.Tri)).MinBy(c => Z(c.Tri));
        Assert.Multiple(() => {
            Assert.That(floor.Name, Is.EqualTo("slab top"), "the first floor down is the proxy slab, not the duct or table");
            Assert.That(ceiling.Name, Is.EqualTo("upper slab underside"));
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_DuctCurves, false), Is.EqualTo(HeightRole.None));
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_Floors, false), Is.EqualTo(HeightRole.Floor | HeightRole.Overhead));
            Assert.That(HeightRoles.Of((long)BuiltInCategory.OST_GenericModel, true), Is.EqualTo(HeightRole.None), "a DWG import");
        });
    }

    [Test]
    public void Steep_face_at_the_level_is_not_a_floor() {
        var ramp = new Tri { A = new Vector3(0, 0, 0), B = new Vector3(10, 0, 1), C = new Vector3(0, 10, 0) };
        Assert.That(HeightRoles.Floor(HeightRole.ByGeometry, ramp, Levels), Is.False);
    }

    // Wound down on purpose: facing is not read, so a slab reads the same either way up.
    private static Tri Flat(double z) {
        var f = (float)z;
        return new Tri { A = new Vector3(0, 0, f), B = new Vector3(0, 10, f), C = new Vector3(10, 0, f) };
    }

    private static double Z(Tri t) => (t.A.Z + t.B.Z + t.C.Z) / 3.0;
}
