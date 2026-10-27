using System.Numerics;
using Pe.Revit.Space;

namespace Pe.Revit.Tests;

public sealed class SpaceProximityKernelTests {
    // Face, three edges, and three vertices exercise every closest-point region of the numerical kernel.
    [TestCase(0.5, 0.5, 2, 0.5, 0.5, 0)]
    [TestCase(1, -1, 2, 1, 0, 0)]
    [TestCase(-1, 1, 2, 0, 1, 0)]
    [TestCase(2, 2, 2, 1, 1, 0)]
    [TestCase(-1, -1, 2, 0, 0, 0)]
    [TestCase(3, -1, 2, 2, 0, 0)]
    [TestCase(-1, 3, 2, 0, 2, 0)]
    [TestCase(0.5, 0.5, 0, 0.5, 0.5, 0)]
    [TestCase(1, 1, 0, 1, 1, 0)]
    public void NumericPointDistancePreservesDistanceAndClosestWitness(
        float x, float y, float z, double closestX, double closestY, double closestZ) {
        var triangle = new Tri { A = Vector3.Zero, B = new Vector3(2, 0, 0), C = new Vector3(0, 2, 0) };
        var numeric = Geom.PointTriangle(new Vector3(x, y, z), triangle);
        var point = new XYZ(x, y, z);
        var distance = Geom.SegmentTriangle(point, point, triangle, out var closest);
        var dx = x - closestX;
        var dy = y - closestY;
        var dz = z - closestZ;
        var expected = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        Assert.That(BitConverter.DoubleToInt64Bits(numeric), Is.EqualTo(BitConverter.DoubleToInt64Bits(expected)));
        Assert.That(BitConverter.DoubleToInt64Bits(distance), Is.EqualTo(BitConverter.DoubleToInt64Bits(numeric)));
        Assert.That((closest.X, closest.Y, closest.Z), Is.EqualTo((closestX, closestY, closestZ)));
    }

    [Test]
    public void WithinPreservesTheConservativeGateAcrossMultipleTreeLevels() {
        var focus = Enumerable.Range(0, 1025).Select(i => new Tri {
            A = new Vector3(i % 41, i / 41, 0),
            B = new Vector3(i % 41 + 0.75f, i / 41, 0),
            C = new Vector3(i % 41, i / 41 + 0.75f, 0)
        }).ToArray();
        var tree = Bvh.Build(focus);
        foreach (var radius in new[] { 0d, 0.25, 2, 15 }) {
            foreach (var offset in new[] { -100f, -1, 0, 1, 100 }) {
                var candidate = new Tri {
                    A = new Vector3(offset, -30, 2), B = new Vector3(offset + 10, 40, 2),
                    C = new Vector3(offset + 1, 0, 3)
                };
                var centre = (candidate.A + candidate.B + candidate.C) / 3f;
                var reach = Math.Max(Vector3.Distance(centre, candidate.A),
                    Math.Max(Vector3.Distance(centre, candidate.B), Vector3.Distance(centre, candidate.C)));
                var cap = radius + reach + Math.Max(1, Math.Max(Math.Abs(centre.X),
                    Math.Max(Math.Abs(centre.Y), Math.Abs(centre.Z)))) * Math.Pow(2, -21);
                var expected = focus.Any(triangle => Geom.PointTriangle(centre, triangle) <= cap);
                Assert.That(tree.Within(candidate, radius), Is.EqualTo(expected), $"offset={offset}, radius={radius}");
            }
        }
        Assert.That(Bvh.Build([]).Within(focus[0], 15), Is.False);
    }
}
