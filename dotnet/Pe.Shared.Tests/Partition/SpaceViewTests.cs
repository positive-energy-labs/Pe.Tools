using System.Numerics;
using System.Reflection;
using NUnit.Framework;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class SpaceViewTests {
    [TestCase(0.16, true)]
    [TestCase(1.04, false)]
    [TestCase(2.08, false)]
    public void Body_coverage_rejects_a_cuff_but_keeps_half_or_more(double extent, bool retry) {
        foreach (var body in new[] { new Aabb(0, 0, 0, 2.08, .5, .5), new Aabb(0, 0, 0, .5, 2.08, .5), new Aabb(0, 0, 0, .5, .5, 2.08) }) {
            var drawn = new Aabb(0, 0, 0, Math.Min(body.MaxX, extent), Math.Min(body.MaxY, extent), Math.Min(body.MaxZ, extent));
            Assert.That(Measure("CoverageBy", body, drawn) < .5, Is.EqualTo(retry));
        }
        Assert.That(Measure("CoverageBy", new Aabb(), new Aabb()), Is.EqualTo(1));
    }

    [Test]
    public void Context_distance_measures_box_separation_not_centres_or_ids() {
        var focus = new Aabb(0, 0, 0, 10, 10, 10);
        var touching = new Aabb(10, 2, 2, 100, 3, 3);
        var near = new Aabb(12, 2, 2, 13, 3, 3);
        var far = new Aabb(12, 13, 10, 13, 14, 11);
        Assert.That(Measure("DistanceSquared", focus, touching), Is.Zero);
        Assert.That(new[] { far, near, touching }.OrderBy(b => Measure("DistanceSquared", focus, b)), Is.EqualTo(new[] { touching, near, far }));
        Assert.That(Measure("DistanceSquared", focus, far), Is.EqualTo(13));
    }

    private static double Measure(string method, Aabb body, Aabb drawn) =>
        (double)typeof(Aabb).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(body, [drawn])!;

    [Test]
    public void Tree_depth_is_inclusive_and_inner_counts_include_hidden_descendants() {
        var triangles = Enumerable.Range(0, 33).Select(i => new Tri {
            A = new Vector3(i, 0, 0), B = new Vector3(i, 1, 0), C = new Vector3(i, 0, 1)
        }).ToArray();
        var root = Walk(triangles, 0).Single();
        Assert.Multiple(() => {
            Assert.That(root.Index, Is.Zero);
            Assert.That(root.Depth, Is.Zero);
            Assert.That(root.Leaf, Is.False);
            Assert.That(root.Triangles, Is.EqualTo(33));
            Assert.That(root.Box, Is.EqualTo(new float[] { 0, 0, 0, 32, 1, 1 }));
        });

        var shallow = Walk(triangles, 1);
        Assert.That(shallow.Select(n => n.Depth), Is.EqualTo(new[] { 1, 1, 0 }));
        Assert.That(shallow.Take(2).Sum(n => n.Triangles), Is.EqualTo(root.Triangles));
        var full = Walk(triangles, 20);
        Assert.That(full.Where(n => n.Leaf).Sum(n => n.Triangles), Is.EqualTo(33));
        Assert.That(full.Last().Index, Is.EqualTo(root.Index), "post-order keeps the root last");
        Assert.That(full.All(n => n.Triangles > 0), Is.True);
    }

    [Test]
    public void Empty_tree_has_no_root_and_leaf_tree_has_exact_bounds() {
        Assert.That(Walk([], 8), Is.Empty);
        var leaf = Walk([new Tri { A = new Vector3(-2, 3, 4), B = new Vector3(1, 5, 6), C = new Vector3(0, 7, 8) }], 0).Single();
        Assert.Multiple(() => {
            Assert.That(leaf.Leaf, Is.True);
            Assert.That(leaf.Triangles, Is.EqualTo(1));
            Assert.That(leaf.Box, Is.EqualTo(new float[] { -2, 3, 4, 1, 7, 8 }));
        });
    }

    [Test]
    public void Wire_filter_preserves_default_obstructors_and_explicit_DWG_axes() {
        var solid = new PrimRow(0, 10, "solid", "Walls", PrimKind.Solid, new Aabb(), 1);
        var curve = solid with { Kind = PrimKind.Curve2D, Layer = "A-WALL", ElementId = 20 };
        var defaults = new SpaceView.FilterRequest().ToFilter();
        Assert.That(defaults.Wants(solid), Is.True);
        Assert.That(defaults.Wants(curve), Is.False);
        var filter = new SpaceView.FilterRequest(Sources: ["revitlink"], Kinds: ["curve2d"],
            Categories: ["walls"], Layers: ["a-w*"], ExcludeElementIds: [10]).ToFilter();
        Assert.Multiple(() => {
            Assert.That(filter.Wants(SourceKind.Host), Is.False);
            Assert.That(filter.Wants(SourceKind.RevitLink), Is.True);
            Assert.That(filter.Wants(solid), Is.False);
            Assert.That(filter.Wants(curve), Is.True);
            Assert.That(filter.Wants(curve with { ElementId = 10 }), Is.False);
        });
    }

    private static IReadOnlyList<BvhNode> Walk(Tri[] triangles, int depth) {
        var type = typeof(SpaceView).Assembly.GetType("Pe.Revit.Space.Bvh", true)!;
        var tree = type.GetMethod("Build", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, [triangles]);
        return (IReadOnlyList<BvhNode>)type.GetMethod("Walk")!.Invoke(tree, [depth])!;
    }
}
