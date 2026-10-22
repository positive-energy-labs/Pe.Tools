using System.Numerics;
using System.Reflection;
using NUnit.Framework;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

public sealed class SpaceViewTests {
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
