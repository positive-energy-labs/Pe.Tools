using System.Numerics;

namespace Pe.Revit.Space;

/// <summary>A bounded envelope option, not a recovered family frame or a minimum-volume theorem.
/// Frames come only from the element's own triangle edges and normals; every vertex sets the extents.
/// Degenerate geometry keeps its mesh. No world-axis fallback.</summary>
internal static class TriangleBox {
    private readonly record struct V(double X, double Y, double Z) {
        internal static V Of(Vector3 p) => new(p.X, p.Y, p.Z);
        public static V operator +(V a, V b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static V operator -(V a, V b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static V operator *(V a, double n) => new(a.X * n, a.Y * n, a.Z * n);
        internal double Dot(V b) => this.X * b.X + this.Y * b.Y + this.Z * b.Z;
        internal V Cross(V b) => new(this.Y * b.Z - this.Z * b.Y, this.Z * b.X - this.X * b.Z, this.X * b.Y - this.Y * b.X);
        internal double Length => Math.Sqrt(this.Dot(this));
        internal V Unit => this * (1 / this.Length);
        internal double[] Array => [this.X, this.Y, this.Z];
    }
    private sealed record Frame(V X, V Y, V Z) {
        private bool Parallel(V a) => Math.Abs(a.Dot(this.X)) > 1 - 1e-8
            || Math.Abs(a.Dot(this.Y)) > 1 - 1e-8 || Math.Abs(a.Dot(this.Z)) > 1 - 1e-8;
        internal bool Same(Frame b) => b.Parallel(this.X) && b.Parallel(this.Y) && b.Parallel(this.Z);
    }

    internal static SceneOrientedBox? Fit(IReadOnlyList<Tri> triangles, Action check) {
        if (triangles.Count == 0) return null;
        // At most 72 candidate frames. Large planar faces outrank tiny bevels; all vertices still
        // participate in every fit. This bound is disclosed as an approximation, never exact shape.
        var largest = new List<(Tri Element, double Area)>();
        var smallest = 0;
        for (var i = 0; i < triangles.Count; i++) {
            if ((i & 255) == 0) check();
            var t = triangles[i];
            var area = (V.Of(t.B) - V.Of(t.A)).Cross(V.Of(t.C) - V.Of(t.A)).Length;
            if (area <= 1e-12 || double.IsNaN(area) || double.IsInfinity(area)) continue;
            if (largest.Count < 24) largest.Add((t, area));
            else if (area > largest[smallest].Area) largest[smallest] = (t, area);
            else continue;
            if (largest.Count == 24)
                for (var j = 0; j < largest.Count; j++) if (largest[j].Area < largest[smallest].Area) smallest = j;
        }
        var frames = new List<Frame>();
        foreach (var item in largest.OrderByDescending(item => item.Area)) {
            var a = V.Of(item.Element.A); var b = V.Of(item.Element.B); var c = V.Of(item.Element.C);
            var z = (b - a).Cross(c - a).Unit;
            foreach (var edge in new[] { b - a, c - a, c - b }) {
                var x = edge.Unit; var y = z.Cross(x).Unit;
                var frame = new Frame(x, y, x.Cross(y).Unit);
                if (!frames.Any(prior => prior.Same(frame))) frames.Add(frame);
            }
        }
        var origin = V.Of(triangles[0].A);
        var bestVolume = double.PositiveInfinity;
        SceneOrientedBox? best = null;
        foreach (var frame in frames) {
            check();
            var min = new[] { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
            var max = new[] { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };
            var axes = new[] { frame.X, frame.Y, frame.Z };
            for (var i = 0; i < triangles.Count; i++) {
                if ((i & 255) == 0) check();
                var t = triangles[i];
                Include(t.A); Include(t.B); Include(t.C);
            }
            var half = new[] { (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2 };
            var volume = half[0] * half[1] * half[2];
            if (half.Any(h => h <= 1e-8) || volume >= bestVolume || double.IsNaN(volume)) continue;
            bestVolume = volume;
            var center = origin;
            for (var j = 0; j < 3; j++) center += axes[j] * ((min[j] + max[j]) / 2);
            best = new SceneOrientedBox(center.Array, frame.X.Array, frame.Y.Array, frame.Z.Array, half, SceneBoxFrame.Triangles);
            void Include(Vector3 point) {
                var local = V.Of(point) - origin;
                for (var j = 0; j < 3; j++) {
                    var at = local.Dot(axes[j]);
                    min[j] = Math.Min(min[j], at); max[j] = Math.Max(max[j], at);
                }
            }
        }
        return best;
    }
}
