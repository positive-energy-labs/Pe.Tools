namespace Pe.Revit.Space;

/// <summary>An operation-local index over focus element bounds, never their Revit objects.</summary>
internal sealed class SceneFocusIndex {
    private sealed record Node(Aabb Box, Node? Left, Node? Right);
    private readonly Node? _root;
    internal SceneFocusIndex(Aabb[] boxes) => this._root = Build(boxes, 0, boxes.Length);
    private static Node? Build(Aabb[] boxes, int start, int count) {
        if (count == 0) return null;
        var box = boxes[start];
        for (var i = start + 1; i < start + count; i++) box = Union(box, boxes[i]);
        if (count == 1) return new Node(box, null, null);
        var x = box.MaxX - box.MinX; var y = box.MaxY - box.MinY; var z = box.MaxZ - box.MinZ;
        var axis = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
        double Centre(Aabb b) => axis == 0 ? b.MinX + b.MaxX : axis == 1 ? b.MinY + b.MaxY : b.MinZ + b.MaxZ;
        Array.Sort(boxes, start, count, Comparer<Aabb>.Create((a, b) => Centre(a).CompareTo(Centre(b))));
        var half = count / 2;
        return new Node(box, Build(boxes, start, half), Build(boxes, start + half, count - half));
    }
    internal bool Overlaps(Aabb bounds, double padding) => Overlaps(this._root, bounds, padding);
    private static bool Overlaps(Node? node, Aabb bounds, double padding) => node is not null && node.Box.Expand(padding).Overlaps(bounds)
        && (node.Left is null || Overlaps(node.Left, bounds, padding) || Overlaps(node.Right, bounds, padding));
    internal bool ContainedBy(Aabb bounds) => ContainedBy(this._root, bounds);
    private static bool Contains(Aabb a, Aabb b) => a.MinX <= b.MinX && a.MinY <= b.MinY && a.MinZ <= b.MinZ
        && a.MaxX >= b.MaxX && a.MaxY >= b.MaxY && a.MaxZ >= b.MaxZ;
    private static bool ContainedBy(Node? node, Aabb bounds) => node is not null && node.Box.Overlaps(bounds)
        && (Contains(bounds, node.Box) || (node.Left is not null && (ContainedBy(node.Left, bounds) || ContainedBy(node.Right, bounds))));
    internal double DistanceSquared(Aabb bounds) {
        var best = double.PositiveInfinity;
        void Visit(Node? node) {
            if (node is null || node.Box.DistanceSquared(bounds) >= best) return;
            if (node.Left is null) { best = node.Box.DistanceSquared(bounds); return; }
            var first = node.Left!; var second = node.Right!;
            if (first.Box.DistanceSquared(bounds) > second.Box.DistanceSquared(bounds)) (first, second) = (second, first);
            Visit(first); Visit(second);
        }
        Visit(this._root);
        return this._root is null ? 0 : best;
    }
    private static Aabb Union(Aabb a, Aabb b) => new(Math.Min(a.MinX, b.MinX), Math.Min(a.MinY, b.MinY), Math.Min(a.MinZ, b.MinZ),
        Math.Max(a.MaxX, b.MaxX), Math.Max(a.MaxY, b.MaxY), Math.Max(a.MaxZ, b.MaxZ));
}
