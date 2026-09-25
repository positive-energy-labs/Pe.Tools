using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// The five faces rails16 failed to draw on Chadds Main Level (main 0c1b4597), reconstructed by Solve.RunRails on the
// main-09-doors knee with each zone's outline from the w14 snapshot.
public sealed class KernelRingsTests
{
    // 0 sf held zone-edge-only faces: three collinear points on the zone's 45 degree edge.
    private static readonly double[][] Collinear =
    [
        [249.549782, 614.58397, 248.5961, 615.5376, 247.152242, 616.981511], // 13ff7b4f R01
        [334.007748, 672.488394, 335.0078, 671.4884, 338.920604, 667.575538], // d5ce6239 R03
        [285.015587, 634.052707, 284.5743, 633.6114, 284.280296, 633.317417], // e59d6c7b R06
        [237.068337, 570.641757, 237.06834, 570.64176, 237.285479, 570.424616], // 8a3ab273 R09
    ];

    // 27022a9d R02, accepted 1113.67 sf: the hole fills a notch of the outer, 2.7e-5 ft off two of its edges.
    private static readonly double[] R14Outer = [443.363228, 740.859127, 455.66265, 740.858771, 455.66265, 686.941873, 451.308482, 686.941873, 451.308482, 691.131196, 440.376413, 691.130803, 445.4858, 691.131, 440.376413, 691.130803, 440.3019, 691.1308, 440.28, 691.1621, 440.087, 691.4379, 440.0872, 691.1682, 438.0047, 691.1663, 437.0453, 691.4352, 436.3265, 691.6366, 436.3266, 691.5218, 432.8708, 691.5187, 432.870742, 691.58578, 432.870843, 695.09559, 432.870843, 695.09559, 432.870953, 698.891588, 432.870982, 699.891661, 431.52592, 699.8917, 430.0109, 699.891744, 429.8181, 699.891749, 429.818051, 699.891749, 429.818, 702.278622, 429.818048, 700.05644, 429.818, 702.278776, 429.817948, 704.710683, 429.817948, 704.710683, 429.817916, 706.1776, 429.8179, 706.939221, 429.817861, 708.766245, 431.371237, 708.7662, 433.037991, 708.766152, 433.037991, 708.7662, 433.037766, 714.829463, 433.0379, 712.1409, 433.037766, 714.829463, 433.037643, 718.141, 433.0376, 719.287652, 433.036941, 737.044978, 443.363367, 737.044679];
    private static readonly double[] R14Hole = [451.3125, 687.1499, 451.3127, 686.9419, 453.8806, 686.9419, 454.8082, 686.9419, 454.8499, 686.9419, 455.6626, 686.9419, 455.6626, 686.9438, 455.6626, 691.1762, 451.3088, 691.1722, 451.3093, 690.5793];

    private static List<double[]> Pts(double[] flat) => Enumerable.Range(0, flat.Length / 2).Select(i => new[] { flat[2 * i], flat[2 * i + 1] }).ToList();

    [Test]
    public void Collinear_zero_area_faces_build_nothing()
    {
        foreach (var loop in Collinear) Assert.That(Kernel.Rings(Pts(loop), []), Is.Empty);
    }

    [Test]
    public void A_hole_touching_the_outer_is_subtracted_into_one_valid_ring()
    {
        var rings = Kernel.Rings(Pts(R14Outer), [Pts(R14Hole)]);
        Assert.That(rings, Has.Count.EqualTo(1));
        Assert.That(Math.Abs(Kernel.Shoelace(rings[0])), Is.EqualTo(1113.67).Within(0.05));
        var ring = NetTopologySuite.NtsGeometryServices.Instance.CreateGeometryFactory().CreatePolygon(
            [.. rings[0].Select(p => new NetTopologySuite.Geometries.Coordinate(p[0], p[1])), new NetTopologySuite.Geometries.Coordinate(rings[0][0][0], rings[0][0][1])]);
        Assert.That(ring.IsValid, Is.True);
    }

    [Test]
    public void A_hole_clear_of_the_outer_stays_a_hole()
    {
        var rings = Kernel.Rings([[0, 0], [10, 0], [10, 10], [0, 10]], [[[4, 4], [6, 4], [6, 6], [4, 6]]]);
        Assert.That(rings.Select(r => Math.Abs(Kernel.Shoelace(r))), Is.EqualTo(new[] { 100.0, 4.0 }));
    }
}
