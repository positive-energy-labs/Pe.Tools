namespace Pe.Revit.Space;

/// <summary>
///     Flat binary tree over one partition's triangles. Median split on the centroid of the widest
///     axis, up to 8 triangles per leaf. Two queries: closest triangle to a segment within a radius,
///     and box overlap. No library.
///     ponytail: build is O(n log n) with a full sort per node and the whole tree is rebuilt on any
///     patch. Refit or a partial rebuild is the upgrade when a patch costs more than the question.
/// </summary>
internal sealed class Bvh {
    /// <summary>
    ///     32 bytes: six floats of box and two ints. The vertices are already float, so the box
    ///     bounds are exactly representable and the pack loses nothing. <c>Count</c> above zero
    ///     means a leaf of that many entries at <c>Start</c>; otherwise the right child sits at
    ///     <c>-Count</c> and the left child is the next node.
    /// </summary>
    private struct Node {
        public float MinX, MinY, MinZ, MaxX, MaxY, MaxZ;
        public int Start;
        public int Count;
    }

    private const int LeafMax = 8;

    private readonly Tri[] _tris;
    private readonly int[] _order;
    private readonly Node[] _nodes;
    private readonly int _used;

    private Bvh(Tri[] tris, int[] order, Node[] nodes, int used) {
        this._tris = tris;
        this._order = order;
        this._nodes = nodes;
        this._used = used;
    }

    public static Bvh Build(Tri[] tris) {
        var n = tris.Length;
        var order = new int[n];
        for (var i = 0; i < n; i++) order[i] = i;
        if (n == 0) return new Bvh(tris, order, [], 0);

        var centroids = new Vector3[n];
        for (var i = 0; i < n; i++) centroids[i] = (tris[i].A + tris[i].B + tris[i].C) / 3f;

        // A median split only recurses above LeafMax, so every leaf holds at least LeafMax/2
        // triangles: leaves <= n/4 and total nodes <= n/2. Sized exactly, never resized.
        var nodes = new Node[Math.Max(16, (n / 2) + 16)];
        var used = 0;
        Split(tris, centroids, order, 0, n, nodes, ref used);
        return new Bvh(tris, order, nodes, used);
    }

    private static int Split(
        Tri[] tris,
        Vector3[] centroids,
        int[] order,
        int start,
        int count,
        Node[] nodes,
        ref int used
    ) {
        var self = used++;

        var mn = new Vector3(float.MaxValue);
        var mx = new Vector3(float.MinValue);
        for (var i = start; i < start + count; i++) {
            var t = tris[order[i]];
            mn = Vector3.Min(mn, Vector3.Min(t.A, Vector3.Min(t.B, t.C)));
            mx = Vector3.Max(mx, Vector3.Max(t.A, Vector3.Max(t.B, t.C)));
        }

        nodes[self] = new Node {
            MinX = mn.X, MinY = mn.Y, MinZ = mn.Z,
            MaxX = mx.X, MaxY = mx.Y, MaxZ = mx.Z,
            Start = start,
            Count = count,
        };
        if (count <= LeafMax) return self;

        // Widest centroid axis, median split. Degenerate spreads fall back to a positional half.
        var cmn = new Vector3(float.MaxValue);
        var cmx = new Vector3(float.MinValue);
        for (var i = start; i < start + count; i++) {
            cmn = Vector3.Min(cmn, centroids[order[i]]);
            cmx = Vector3.Max(cmx, centroids[order[i]]);
        }

        var d = cmx - cmn;
        var axis = d.X >= d.Y && d.X >= d.Z ? 0 : d.Y >= d.Z ? 1 : 2;

        var slice = new int[count];
        Array.Copy(order, start, slice, 0, count);
        var keys = new float[count];
        for (var i = 0; i < count; i++) {
            var c = centroids[slice[i]];
            keys[i] = axis == 0 ? c.X : axis == 1 ? c.Y : c.Z;
        }

        Array.Sort(keys, slice);
        Array.Copy(slice, 0, order, start, count);

        var half = count / 2;
        _ = Split(tris, centroids, order, start, half, nodes, ref used);
        var right = Split(tris, centroids, order, start + half, count - half, nodes, ref used);
        // A right child is never the root and never the node after its parent, so -right is always
        // at most -2 and can never be mistaken for a leaf count.
        nodes[self].Count = -right;
        return self;
    }

    /// <summary>
    ///     Nearest triangle to the segment p0..p1 whose distance is under <paramref name="radius" />.
    ///     Returns -1 when nothing is inside the radius. Distances are exact segment-to-triangle,
    ///     computed in double from the float store. acceptPrim gates on the PrimRow index; filtering
    ///     there rather than after the answer is what keeps a filtered-out nearest element from
    ///     turning into a false CLEAR.
    /// </summary>
    public int ClosestToSegment(
        XYZ p0,
        XYZ p1,
        double radius,
        Func<int, bool>? acceptPrim,
        out double distance,
        out XYZ closest,
        out int examined
    ) {
        distance = radius;
        closest = p0;
        examined = 0;
        var best = -1;
        if (this._used == 0) return -1;

        double sx0 = Math.Min(p0.X, p1.X), sy0 = Math.Min(p0.Y, p1.Y), sz0 = Math.Min(p0.Z, p1.Z);
        double sx1 = Math.Max(p0.X, p1.X), sy1 = Math.Max(p0.Y, p1.Y), sz1 = Math.Max(p0.Z, p1.Z);

        var stack = new Stack<int>();
        stack.Push(0);
        while (stack.Count > 0) {
            var i = stack.Pop();
            ref var node = ref this._nodes[i];
            var r = distance;
            if (node.MaxX < sx0 - r || node.MinX > sx1 + r
                || node.MaxY < sy0 - r || node.MinY > sy1 + r
                || node.MaxZ < sz0 - r || node.MinZ > sz1 + r) continue;

            if (node.Count > 0) {
                for (var k = node.Start; k < node.Start + node.Count; k++) {
                    var ti = this._order[k];
                    var t = this._tris[ti];
                    if (acceptPrim is not null && !acceptPrim(t.Prim)) continue;
                    examined++;
                    var dist = Geom.SegmentTriangle(p0, p1, t, out var cp);
                    if (dist >= distance) continue;
                    distance = dist;
                    closest = cp;
                    best = ti;
                }

                continue;
            }

            stack.Push(i + 1);
            stack.Push(-node.Count);
        }

        if (best < 0) distance = radius;
        return best;
    }

    /// <summary>
    ///     Nearest triangle to an oriented box, by signed box distance, under
    ///     <paramref name="cap" />. Returns -1 when nothing is closer than the cap.
    ///     Nodes are pruned against the box's world bounds grown by the best distance so far, which
    ///     is valid because the world AABB contains the box: a triangle within d of the box is
    ///     within d of its AABB. Once the best is negative the growth is zero and only nodes that
    ///     actually overlap the box survive.
    /// </summary>
    public int ClosestToBox(
        in Obb box,
        double cap,
        Func<int, bool>? acceptPrim,
        out double distance,
        out XYZ closest,
        out int examined
    ) {
        distance = cap;
        closest = box.Centre;
        examined = 0;
        var best = -1;
        if (this._used == 0) return -1;

        var wb = box.WorldBounds();
        var stack = new Stack<int>();
        stack.Push(0);
        while (stack.Count > 0) {
            var i = stack.Pop();
            ref var node = ref this._nodes[i];
            var grow = Math.Max(distance, 0.0);
            if (node.MaxX < wb.MinX - grow || node.MinX > wb.MaxX + grow
                || node.MaxY < wb.MinY - grow || node.MinY > wb.MaxY + grow
                || node.MaxZ < wb.MinZ - grow || node.MinZ > wb.MaxZ + grow) continue;

            if (node.Count > 0) {
                for (var k = node.Start; k < node.Start + node.Count; k++) {
                    var ti = this._order[k];
                    var t = this._tris[ti];
                    if (acceptPrim is not null && !acceptPrim(t.Prim)) continue;
                    examined++;
                    var d = Geom.BoxTriangle(box, t, distance, out var cp);
                    if (d >= distance) continue;
                    distance = d;
                    closest = cp;
                    best = ti;
                }

                continue;
            }

            stack.Push(i + 1);
            stack.Push(-node.Count);
        }

        if (best < 0) distance = cap;
        return best;
    }

    /// <summary>
    ///     The first triangle a ray meets, exactly. Moller-Trumbore per candidate through the same
    ///     routine SegmentTriangle's pierce case uses, so nothing new is trusted here.
    ///     <paramref name="direction" /> need not be a unit vector; <paramref name="distance" /> comes
    ///     back in feet along it. False when nothing is hit inside maxDistance.
    ///     ponytail: nodes are pruned against the whole ray segment's bounds, not shortened as the
    ///     best hit comes in. A headroom probe is a 200 ft segment through one storey, so the tree
    ///     already rejects almost everything; shorten it when a probe gets asked a thousand times.
    /// </summary>
    public bool FirstHitAlongRay(
        XYZ origin,
        XYZ direction,
        double maxDistance,
        Func<Tri, bool>? wants,
        out double distance,
        out int triangle
    ) {
        distance = double.PositiveInfinity;
        triangle = -1;
        if (this._used == 0) return false;

        var len = direction.GetLength();
        if (len < 1e-12 || maxDistance <= 0) return false;
        var unit = direction.Normalize();
        var end = new XYZ(
            origin.X + (unit.X * maxDistance),
            origin.Y + (unit.Y * maxDistance),
            origin.Z + (unit.Z * maxDistance));

        double sx0 = Math.Min(origin.X, end.X), sy0 = Math.Min(origin.Y, end.Y), sz0 = Math.Min(origin.Z, end.Z);
        double sx1 = Math.Max(origin.X, end.X), sy1 = Math.Max(origin.Y, end.Y), sz1 = Math.Max(origin.Z, end.Z);

        var best = double.PositiveInfinity;
        var stack = new Stack<int>();
        stack.Push(0);
        while (stack.Count > 0) {
            var i = stack.Pop();
            ref var node = ref this._nodes[i];
            if (node.MaxX < sx0 || node.MinX > sx1
                || node.MaxY < sy0 || node.MinY > sy1
                || node.MaxZ < sz0 || node.MinZ > sz1) continue;

            if (node.Count > 0) {
                for (var k = node.Start; k < node.Start + node.Count; k++) {
                    var ti = this._order[k];
                    var t = this._tris[ti];
                    if (wants is not null && !wants(t)) continue;
                    if (!Geom.Pierces(origin, end, t, out var s, out _)) continue;
                    var d = s * maxDistance;
                    if (d >= best) continue;
                    best = d;
                    triangle = ti;
                }

                continue;
            }

            stack.Push(i + 1);
            stack.Push(-node.Count);
        }

        if (triangle < 0) return false;
        distance = best;
        return true;
    }

    public Tri Triangle(int i) => this._tris[i];
}

/// <summary>
///     The swept profile as it really is: an oriented box of the segment's length, the profile's
///     width across and height up. Host feet.
///     <para>
///         The up axis is world z, because a duct runs level; that is the assumption this type
///         carries and it is the one to revisit first for a sloped run. A sloped segment still gets
///         a frame — the up axis becomes the in-plane vector closest to world z — but a profile
///         rolled about its own run is not modelled at all.
///     </para>
/// </summary>
internal readonly struct Obb {
    private Obb(XYZ centre, XYZ along, XYZ across, XYZ up, double hu, double hv, double hw) {
        this.Centre = centre;
        this.Along = along;
        this.Across = across;
        this.Up = up;
        this.HalfLength = hu;
        this.HalfWidth = hv;
        this.HalfHeight = hw;
    }

    public XYZ Centre { get; }
    public XYZ Along { get; }
    public XYZ Across { get; }
    public XYZ Up { get; }
    public double HalfLength { get; }
    public double HalfWidth { get; }
    public double HalfHeight { get; }

    public static Obb FromSegment(XYZ p0, XYZ p1, double widthFt, double heightFt) {
        var d = p1 - p0;
        var len = d.GetLength();
        var along = len > 1e-9 ? d.Normalize() : XYZ.BasisX;
        var across = along.CrossProduct(XYZ.BasisZ);
        // A vertical run has no horizontal perpendicular from z; fall back to a stable one.
        across = across.GetLength() > 1e-9 ? across.Normalize() : XYZ.BasisX.CrossProduct(along).Normalize();
        var up = across.CrossProduct(along).Normalize();
        return new Obb(
            new XYZ((p0.X + p1.X) / 2.0, (p0.Y + p1.Y) / 2.0, (p0.Z + p1.Z) / 2.0),
            along, across, up, len / 2.0, widthFt / 2.0, heightFt / 2.0);
    }

    /// <summary>Box frame coordinates of a world point: the box is [-h, h] on each axis here.</summary>
    public void ToLocal(Vector3 p, out double x, out double y, out double z) {
        double dx = p.X - this.Centre.X, dy = p.Y - this.Centre.Y, dz = p.Z - this.Centre.Z;
        x = (dx * this.Along.X) + (dy * this.Along.Y) + (dz * this.Along.Z);
        y = (dx * this.Across.X) + (dy * this.Across.Y) + (dz * this.Across.Z);
        z = (dx * this.Up.X) + (dy * this.Up.Y) + (dz * this.Up.Z);
    }

    public XYZ ToWorld(double x, double y, double z) => new(
        this.Centre.X + (x * this.Along.X) + (y * this.Across.X) + (z * this.Up.X),
        this.Centre.Y + (x * this.Along.Y) + (y * this.Across.Y) + (z * this.Up.Y),
        this.Centre.Z + (x * this.Along.Z) + (y * this.Across.Z) + (z * this.Up.Z));

    /// <summary>World-axis bounds of the eight corners. Used only to prune the tree.</summary>
    public Aabb WorldBounds() {
        var ex = (this.HalfLength * Math.Abs(this.Along.X)) + (this.HalfWidth * Math.Abs(this.Across.X))
            + (this.HalfHeight * Math.Abs(this.Up.X));
        var ey = (this.HalfLength * Math.Abs(this.Along.Y)) + (this.HalfWidth * Math.Abs(this.Across.Y))
            + (this.HalfHeight * Math.Abs(this.Up.Y));
        var ez = (this.HalfLength * Math.Abs(this.Along.Z)) + (this.HalfWidth * Math.Abs(this.Across.Z))
            + (this.HalfHeight * Math.Abs(this.Up.Z));
        return new Aabb(
            this.Centre.X - ex, this.Centre.Y - ey, this.Centre.Z - ez,
            this.Centre.X + ex, this.Centre.Y + ey, this.Centre.Z + ez);
    }
}

/// <summary>
///     Exact segment-to-triangle distance, in double, from the float triangle store. The four cases
///     are: the segment pierces the triangle, an endpoint is closest to the face, the segment is
///     closest to an edge, or an edge endpoint is closest to the segment. The last is folded into
///     the third by the segment-segment test.
/// </summary>
internal static class Geom {
    public static double SegmentTriangle(XYZ p0, XYZ p1, Tri t, out XYZ closest) {
        double ax = t.A.X, ay = t.A.Y, az = t.A.Z;
        double bx = t.B.X, by = t.B.Y, bz = t.B.Z;
        double cx = t.C.X, cy = t.C.Y, cz = t.C.Z;

        // The pierce case is load-bearing: without it a segment through the middle of a large
        // triangle reports the distance to the nearest edge, which is a false CLEAR.
        if (Pierces(p0, p1, ax, ay, az, bx, by, bz, cx, cy, cz, out _, out closest)) return 0.0;

        var d = PointTriangle(p0.X, p0.Y, p0.Z, ax, ay, az, bx, by, bz, cx, cy, cz, out var c0);
        closest = c0;
        var d1 = PointTriangle(p1.X, p1.Y, p1.Z, ax, ay, az, bx, by, bz, cx, cy, cz, out var c1);
        if (d1 < d) { d = d1; closest = c1; }

        Edge(p0, p1, ax, ay, az, bx, by, bz, ref d, ref closest);
        Edge(p0, p1, bx, by, bz, cx, cy, cz, ref d, ref closest);
        Edge(p0, p1, cx, cy, cz, ax, ay, az, ref d, ref closest);
        return d;
    }

    private static void Edge(
        XYZ p0, XYZ p1,
        double ux, double uy, double uz,
        double vx, double vy, double vz,
        ref double best, ref XYZ closest
    ) {
        var d = SegmentSegment(p0.X, p0.Y, p0.Z, p1.X, p1.Y, p1.Z, ux, uy, uz, vx, vy, vz, out var q);
        if (d >= best) return;
        best = d;
        closest = q;
    }

    // Moller-Trumbore, restricted to the parameter range of the segment.
    /// <summary>Moller-Trumbore against one triangle, restricted to the segment. <paramref name="s" />
    /// is the hit parameter along p0..p1, so a ray reads its distance as s times the segment length.
    /// This is the same routine the pierce case of SegmentTriangle has always used.</summary>
    public static bool Pierces(XYZ p0, XYZ p1, Tri t, out double s, out XYZ at) => Pierces(
        p0, p1, t.A.X, t.A.Y, t.A.Z, t.B.X, t.B.Y, t.B.Z, t.C.X, t.C.Y, t.C.Z, out s, out at);

    private static bool Pierces(
        XYZ p0, XYZ p1,
        double ax, double ay, double az,
        double bx, double by, double bz,
        double cx, double cy, double cz,
        out double s,
        out XYZ at
    ) {
        at = p0;
        s = 0.0;
        double dx = p1.X - p0.X, dy = p1.Y - p0.Y, dz = p1.Z - p0.Z;
        double e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        double e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        double hx = (dy * e2z) - (dz * e2y), hy = (dz * e2x) - (dx * e2z), hz = (dx * e2y) - (dy * e2x);
        var det = (e1x * hx) + (e1y * hy) + (e1z * hz);
        if (Math.Abs(det) < 1e-14) return false;
        var inv = 1.0 / det;
        double sx = p0.X - ax, sy = p0.Y - ay, sz = p0.Z - az;
        var u = inv * ((sx * hx) + (sy * hy) + (sz * hz));
        if (u is < 0.0 or > 1.0) return false;
        double qx = (sy * e1z) - (sz * e1y), qy = (sz * e1x) - (sx * e1z), qz = (sx * e1y) - (sy * e1x);
        var v = inv * ((dx * qx) + (dy * qy) + (dz * qz));
        if (v < 0.0 || u + v > 1.0) return false;
        s = inv * ((e2x * qx) + (e2y * qy) + (e2z * qz));
        if (s is < 0.0 or > 1.0) return false;
        at = new XYZ(p0.X + (s * dx), p0.Y + (s * dy), p0.Z + (s * dz));
        return true;
    }

    // Ericson, Real-Time Collision Detection, closest point on a triangle to a point.
    private static double PointTriangle(
        double px, double py, double pz,
        double ax, double ay, double az,
        double bx, double by, double bz,
        double cx, double cy, double cz,
        out XYZ closest
    ) {
        double abx = bx - ax, aby = by - ay, abz = bz - az;
        double acx = cx - ax, acy = cy - ay, acz = cz - az;
        double apx = px - ax, apy = py - ay, apz = pz - az;
        var d1 = (abx * apx) + (aby * apy) + (abz * apz);
        var d2 = (acx * apx) + (acy * apy) + (acz * apz);
        if (d1 <= 0 && d2 <= 0) return Done(px, py, pz, ax, ay, az, out closest);

        double bpx = px - bx, bpy = py - by, bpz = pz - bz;
        var d3 = (abx * bpx) + (aby * bpy) + (abz * bpz);
        var d4 = (acx * bpx) + (acy * bpy) + (acz * bpz);
        if (d3 >= 0 && d4 <= d3) return Done(px, py, pz, bx, by, bz, out closest);

        var vc = (d1 * d4) - (d3 * d2);
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            var w = d1 / (d1 - d3);
            return Done(px, py, pz, ax + (w * abx), ay + (w * aby), az + (w * abz), out closest);
        }

        double cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        var d5 = (abx * cpx) + (aby * cpy) + (abz * cpz);
        var d6 = (acx * cpx) + (acy * cpy) + (acz * cpz);
        if (d6 >= 0 && d5 <= d6) return Done(px, py, pz, cx, cy, cz, out closest);

        var vb = (d5 * d2) - (d1 * d6);
        if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            var w = d2 / (d2 - d6);
            return Done(px, py, pz, ax + (w * acx), ay + (w * acy), az + (w * acz), out closest);
        }

        var va = (d3 * d6) - (d5 * d4);
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            var w = (d4 - d3) / (d4 - d3 + (d5 - d6));
            return Done(px, py, pz, bx + (w * (cx - bx)), by + (w * (cy - by)), bz + (w * (cz - bz)), out closest);
        }

        var denom = 1.0 / (va + vb + vc);
        var s = vb * denom;
        var tt = vc * denom;
        return Done(px, py, pz,
            ax + (abx * s) + (acx * tt), ay + (aby * s) + (acy * tt), az + (abz * s) + (acz * tt),
            out closest);
    }

    private static double Done(double px, double py, double pz, double qx, double qy, double qz, out XYZ closest) {
        closest = new XYZ(qx, qy, qz);
        double dx = px - qx, dy = py - qy, dz = pz - qz;
        return Math.Sqrt((dx * dx) + (dy * dy) + (dz * dz));
    }

    // Ericson, closest points of two segments. Returns the distance and the point on the second.
    private static double SegmentSegment(
        double p1x, double p1y, double p1z, double q1x, double q1y, double q1z,
        double p2x, double p2y, double p2z, double q2x, double q2y, double q2z,
        out XYZ onSecond
    ) {
        double dx1 = q1x - p1x, dy1 = q1y - p1y, dz1 = q1z - p1z;
        double dx2 = q2x - p2x, dy2 = q2y - p2y, dz2 = q2z - p2z;
        double rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
        var a = (dx1 * dx1) + (dy1 * dy1) + (dz1 * dz1);
        var e = (dx2 * dx2) + (dy2 * dy2) + (dz2 * dz2);
        var f = (dx2 * rx) + (dy2 * ry) + (dz2 * rz);
        double s, t;
        if (a <= 1e-18 && e <= 1e-18) { s = 0; t = 0; }
        else if (a <= 1e-18) { s = 0; t = Clamp(f / e); }
        else {
            var c = (dx1 * rx) + (dy1 * ry) + (dz1 * rz);
            if (e <= 1e-18) { t = 0; s = Clamp(-c / a); }
            else {
                var b = (dx1 * dx2) + (dy1 * dy2) + (dz1 * dz2);
                var denom = (a * e) - (b * b);
                s = denom > 1e-18 ? Clamp(((b * f) - (c * e)) / denom) : 0.0;
                t = ((b * s) + f) / e;
                if (t < 0) { t = 0; s = Clamp(-c / a); }
                else if (t > 1) { t = 1; s = Clamp((b - c) / a); }
            }
        }

        var c1x = p1x + (dx1 * s); var c1y = p1y + (dy1 * s); var c1z = p1z + (dz1 * s);
        var c2x = p2x + (dx2 * t); var c2y = p2y + (dy2 * t); var c2z = p2z + (dz2 * t);
        onSecond = new XYZ(c2x, c2y, c2z);
        double ddx = c1x - c2x, ddy = c1y - c2y, ddz = c1z - c2z;
        return Math.Sqrt((ddx * ddx) + (ddy * ddy) + (ddz * ddz));
    }

    private static double Clamp(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    /// <summary>
    ///     Signed distance from a triangle to an oriented box, worked in the box's own frame where
    ///     the box is the axis-aligned [-h, h]. Negative means the triangle enters the box; the
    ///     magnitude is then the smallest separating-axis overlap, which bounds a penetration rather
    ///     than certifying one. Only the sign carries a verdict and no claim reads that magnitude
    ///     as a depth.
    ///     Positive is the exact distance between two disjoint convex sets: the closest pair of
    ///     features can only be a triangle vertex against a box face, a box vertex against the
    ///     triangle, or an edge against an edge, and all three are tested.
    ///     <paramref name="cap" /> lets a cheap axis-aligned bound throw a far triangle out before
    ///     any of that runs; a value returned at or above the cap carries no closest point.
    ///     ponytail: the exact pass allocates about 44 XYZ per surviving candidate through the
    ///     existing PointTriangle and SegmentSegment routines. A sweep examines hundreds of
    ///     triangles, not millions, so that is not worth paying down; rewrite both to structs if a
    ///     battery ever says it is.
    /// </summary>
    public static double BoxTriangle(in Obb box, Tri t, double cap, out XYZ closest) {
        closest = box.Centre;
        box.ToLocal(t.A, out var ax, out var ay, out var az);
        box.ToLocal(t.B, out var bx, out var by, out var bz);
        box.ToLocal(t.C, out var cx, out var cy, out var cz);
        double hx = box.HalfLength, hy = box.HalfWidth, hz = box.HalfHeight;

        // Both shapes are axis aligned in this frame, so their gap is a free and valid lower bound.
        // Almost every candidate that reaches a leaf dies on this line.
        var gx = Math.Max(0.0, Math.Max(Math.Min(ax, Math.Min(bx, cx)) - hx, -hx - Math.Max(ax, Math.Max(bx, cx))));
        var gy = Math.Max(0.0, Math.Max(Math.Min(ay, Math.Min(by, cy)) - hy, -hy - Math.Max(ay, Math.Max(by, cy))));
        var gz = Math.Max(0.0, Math.Max(Math.Min(az, Math.Min(bz, cz)) - hz, -hz - Math.Max(az, Math.Max(bz, cz))));
        var lower = Math.Sqrt((gx * gx) + (gy * gy) + (gz * gz));
        // A strictly positive bound cannot beat a negative cap, but a zero one can: once any
        // triangle overlaps, cap is negative, and returning early on lower == 0 would let the first
        // overlap found stand as the answer instead of the deepest.
        if (lower > 0.0 && lower >= cap) return lower;

        if (lower <= 0.0) {
            var overlap = SatOverlap(ax, ay, az, bx, by, bz, cx, cy, cz, hx, hy, hz);
            if (overlap > 0.0) {
                var wa = Math.Max(Math.Abs(ax) - hx, Math.Max(Math.Abs(ay) - hy, Math.Abs(az) - hz));
                var wb = Math.Max(Math.Abs(bx) - hx, Math.Max(Math.Abs(by) - hy, Math.Abs(bz) - hz));
                var wc = Math.Max(Math.Abs(cx) - hx, Math.Max(Math.Abs(cy) - hy, Math.Abs(cz) - hz));
                closest = wa <= wb && wa <= wc ? box.ToWorld(ax, ay, az)
                    : wb <= wc ? box.ToWorld(bx, by, bz)
                    : box.ToWorld(cx, cy, cz);
                return -overlap;
            }
        }

        var best = cap;
        double lx = 0, ly = 0, lz = 0;
        var found = false;

        void Take(double d, double x, double y, double z) {
            if (d >= best) return;
            best = d;
            lx = x;
            ly = y;
            lz = z;
            found = true;
        }

        void TakeEdge(
            double q0x, double q0y, double q0z, double q1x, double q1y, double q1z,
            double r0x, double r0y, double r0z, double r1x, double r1y, double r1z
        ) {
            var d = SegmentSegment(q0x, q0y, q0z, q1x, q1y, q1z, r0x, r0y, r0z, r1x, r1y, r1z, out var q);
            Take(d, q.X, q.Y, q.Z);
        }

        // (a) a triangle vertex against a box face.
        Take(PointAabb(ax, ay, az, hx, hy, hz), ax, ay, az);
        Take(PointAabb(bx, by, bz, hx, hy, hz), bx, by, bz);
        Take(PointAabb(cx, cy, cz, hx, hy, hz), cx, cy, cz);

        // (b) each of the eight box corners against the triangle.
        for (var s = 0; s < 8; s++) {
            var px = (s & 1) == 0 ? -hx : hx;
            var py = (s & 2) == 0 ? -hy : hy;
            var pz = (s & 4) == 0 ? -hz : hz;
            var d = PointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out var q);
            Take(d, q.X, q.Y, q.Z);
        }

        // (c) each of the twelve box edges against each of the three triangle edges.
        for (var axis = 0; axis < 3; axis++) {
            for (var s = 0; s < 4; s++) {
                var u = (s & 1) == 0 ? -1.0 : 1.0;
                var v = (s & 2) == 0 ? -1.0 : 1.0;
                double e0x, e0y, e0z, e1x, e1y, e1z;
                if (axis == 0) {
                    e0x = -hx; e1x = hx;
                    e0y = e1y = u * hy;
                    e0z = e1z = v * hz;
                } else if (axis == 1) {
                    e0y = -hy; e1y = hy;
                    e0x = e1x = u * hx;
                    e0z = e1z = v * hz;
                } else {
                    e0z = -hz; e1z = hz;
                    e0x = e1x = u * hx;
                    e0y = e1y = v * hy;
                }

                TakeEdge(e0x, e0y, e0z, e1x, e1y, e1z, ax, ay, az, bx, by, bz);
                TakeEdge(e0x, e0y, e0z, e1x, e1y, e1z, bx, by, bz, cx, cy, cz);
                TakeEdge(e0x, e0y, e0z, e1x, e1y, e1z, cx, cy, cz, ax, ay, az);
            }
        }

        if (found) closest = box.ToWorld(lx, ly, lz);
        return best;
    }

    /// <summary>Exact distance from a point to the axis-aligned box [-h, h]. Zero inside.</summary>
    private static double PointAabb(double px, double py, double pz, double hx, double hy, double hz) {
        var dx = Math.Max(Math.Abs(px) - hx, 0.0);
        var dy = Math.Max(Math.Abs(py) - hy, 0.0);
        var dz = Math.Max(Math.Abs(pz) - hz, 0.0);
        return Math.Sqrt((dx * dx) + (dy * dy) + (dz * dz));
    }

    /// <summary>
    ///     Akenine-Moller's triangle against axis-aligned box test over its thirteen axes, keeping
    ///     the smallest overlap instead of discarding it so the sweep has a magnitude to report.
    ///     Returns zero the moment any axis separates the two.
    /// </summary>
    private static double SatOverlap(
        double ax, double ay, double az,
        double bx, double by, double bz,
        double cx, double cy, double cz,
        double hx, double hy, double hz
    ) {
        var best = double.MaxValue;

        bool Axis(double nx, double ny, double nz) {
            var len = Math.Sqrt((nx * nx) + (ny * ny) + (nz * nz));
            if (len < 1e-12) return true; // a degenerate axis separates nothing
            var p0 = (nx * ax) + (ny * ay) + (nz * az);
            var p1 = (nx * bx) + (ny * by) + (nz * bz);
            var p2 = (nx * cx) + (ny * cy) + (nz * cz);
            var r = (hx * Math.Abs(nx)) + (hy * Math.Abs(ny)) + (hz * Math.Abs(nz));
            var lo = Math.Min(p0, Math.Min(p1, p2));
            var hi = Math.Max(p0, Math.Max(p1, p2));
            // Translation depth, not interval intersection length. A triangle is flat, so on an axis
            // it faces edge-on its interval is a single point and an intersection length is always
            // zero — which would read as separated for every triangle lying in a box face's plane.
            var overlap = Math.Min(hi + r, r - lo) / len;
            if (overlap <= 0.0) return false;
            if (overlap < best) best = overlap;
            return true;
        }

        double f0x = bx - ax, f0y = by - ay, f0z = bz - az;
        double f1x = cx - bx, f1y = cy - by, f1z = cz - bz;
        double f2x = ax - cx, f2y = ay - cy, f2z = az - cz;

        if (!Axis(1, 0, 0) || !Axis(0, 1, 0) || !Axis(0, 0, 1)) return 0.0;
        if (!Axis((f0y * f1z) - (f0z * f1y), (f0z * f1x) - (f0x * f1z), (f0x * f1y) - (f0y * f1x))) return 0.0;
        if (!Axis(0, -f0z, f0y) || !Axis(0, -f1z, f1y) || !Axis(0, -f2z, f2y)) return 0.0;
        if (!Axis(f0z, 0, -f0x) || !Axis(f1z, 0, -f1x) || !Axis(f2z, 0, -f2x)) return 0.0;
        if (!Axis(-f0y, f0x, 0) || !Axis(-f1y, f1x, 0) || !Axis(-f2y, f2x, 0)) return 0.0;
        return best;
    }
}
