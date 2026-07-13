namespace Pe.Revit.Takeoff;

// One curve of the shared boundary network. IsArc is retained on the contract for the
// materializer/tests, but this network emits STRAIGHT LINES ONLY (see the law below).
internal readonly record struct BoundaryCurve(
    double X1, double Y1, double X2, double Y2, double MidX, double MidY, bool IsArc);

// One shared boundary network for all accepted takeoff regions.
//
// THE STRAIGHT-ONLY LAW (pull-back decided 2026-07-12 after the curve/hole-solving ambition
// produced diagonal artifacts across whole plans): the network emits only straight segments, and
// every segment is either ON a consensus wall line or an axis-aligned connector between wall
// lines. Anything the priors cannot explain is emitted raster-faithful and flagged UNRESOLVED for
// the human/Pea draft loop — the engine never invents a diagonal or a curve to look finished.
// Curved-wall support was removed wholesale; curved rooms land in the unresolved bucket.
//
//   1. trace paths between junction nodes (grid vertices with degree != 2), remembering which
//      rooms own each path;
//   2. Douglas-Peucker each path at the product tolerance;
//   3. snap near-axis segments to the dominant building directions and cluster them by signed
//      offset across the WHOLE network — each cluster is one physical wall line;
//   4. re-solve every vertex from its incident wall lines (line x line intersection, projection);
//   5. each remaining free run (door opening, open-plan seam, off-axis wall) emits as a straight
//      axis-aligned seam or an axis-aligned L connector when one fits the raster within
//      allowance; otherwise the raw fitted polyline is emitted and the owning rooms are flagged.
internal static class SpaceBoundaryNetwork
{
    private const double Scale = 1_000_000;          // fixed-point vertex key quantum (1e-6 ft)
    private const double SnapToleranceDegrees = 12;  // segment direction -> dominant axis
    private const double MaxVertexShiftFt = 2.5;     // cap on how far a re-solved vertex may move
    private const double MinClusterSegmentFt = 1.5;  // shorter segments are noise, not wall votes
    private const double MaxChamferFt = 3.5;         // gap-seal corner damage never exceeds this
    private const double StraightSeamDegrees = 3;    // a "straight" seam must really be on-axis
    private const double SupportedSeamFt = 2.5;      // connector allowance over wall ink (real
                                                     // geometry: never reshape it aggressively)
    private const double UnsupportedSeamFt = 8.0;    // connector allowance with no ink: the seam
                                                     // is an equidistance artifact at an opening —
                                                     // an engineer rules an axis-aligned split

    private readonly record struct GridPoint(long X, long Y);
    private readonly record struct GridEdge(GridPoint A, GridPoint B);
    private readonly record struct Point(double X, double Y);
    private readonly record struct VertexKey(long X, long Y);
    private readonly record struct LineKey(long Dx, long Dy, long Offset);
    private readonly record struct Interval(long Start, long End);

    // A consensus wall line: all points p with Nx*p.x + Ny*p.y == Offset.
    private sealed class WallLine
    {
        public double Dx, Dy, Nx, Ny, Offset, Weight;
    }

    private sealed class PathGeom
    {
        public required List<Point> Raw;      // full-resolution grid points (closed: no dup end)
        public required List<int> FitIndex;   // Douglas-Peucker survivors, as indices into Raw
        public required HashSet<string> Rooms;
        public bool Closed;
        public WallLine?[] Lines = [];        // per fitted segment, or null (free)
    }

    private sealed class NetStats
    {
        public int FreeRuns, StraightSeams, CornerSeams, UnresolvedRuns;
    }

    // Per-path emission buffer. Dirty paths (raster fallbacks, isolated diagonals with no wall
    // evidence) drop their OWNING ROOMS from the result instead of shipping a bewildering shape:
    // a visibly missing room is an easy human fix; a mangled one is not.
    private sealed class Emitter
    {
        public readonly List<BoundaryCurve> Curves = [];
        public readonly List<string> Tags = [];
        public bool Dirty;

        public void Line(Point a, Point b, string tag)
        {
            double dx = a.X - b.X, dy = a.Y - b.Y;
            // Revit refuses curves under ShortCurveTolerance (~1/256 ft); anything this small is
            // raster dust anyway
            if (Math.Sqrt(dx * dx + dy * dy) <= 0.01) return;
            this.Curves.Add(new BoundaryCurve(a.X, a.Y, b.X, b.Y, (a.X + b.X) / 2, (a.Y + b.Y) / 2, false));
            this.Tags.Add(tag);
        }
    }

    internal static IReadOnlyList<BoundaryCurve> Build(
        IEnumerable<RoomResult> rooms, double cellFt, double simplifyFt, Action<string>? log = null)
        => Build(rooms, cellFt, simplifyFt, null, null, log);

    internal static IReadOnlyList<BoundaryCurve> Build(
        IEnumerable<RoomResult> rooms, double cellFt, double simplifyFt,
        Func<double, double, bool>? inkNear, ISet<string>? unresolvedRooms, Action<string>? log = null)
    {
        if (!IsFinite(cellFt) || cellFt <= 0) throw new ArgumentOutOfRangeException(nameof(cellFt));
        if (!IsFinite(simplifyFt) || simplifyFt < 0)
            throw new ArgumentOutOfRangeException(nameof(simplifyFt));

        var paths = TracePaths(rooms, cellFt);
        if (paths.Count == 0) return [];

        double coarse = Math.Min(simplifyFt, 3.5 * cellFt);
        foreach (var path in paths) Simplify(path, coarse);
        // real buildings have wings on different rotations; every strong direction gets its own
        // snap family, so a secondary wing regularizes as cleanly as the dominant one
        var axes = DominantAxes(paths);
        // consensus window: generous enough for raster centerline wobble (+/- 2 cells at product
        // resolution), never wide enough to swallow a distinct parallel wall one coarse cell away
        double consensusFt = Math.Min(0.5, 2 * cellFt);
        int wallLines = ClusterWallLines(paths, axes, consensusFt);
        var forced = CollapseChamfers(paths);
        var resolved = ResolveVertices(paths, forced);
        WeldVertices(resolved, Math.Min(0.5, 2 * cellFt));

        var stats = new NetStats();
        var emitters = new List<(PathGeom Path, Emitter Em)>();
        foreach (var path in paths)
        {
            var em = new Emitter();
            EmitPath(path, resolved, axes, inkNear, em, stats);
            emitters.Add((path, em));
        }
        ClassifyOffAxis(emitters, axes, inkNear, log);

        // drop, don't mangle: every room touching a dirty path vanishes wholesale (an obvious,
        // fixable hole), and curves serving only dropped rooms vanish with it
        var dropped = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (path, em) in emitters)
            if (em.Dirty) dropped.UnionWith(path.Rooms);
        unresolvedRooms?.UnionWith(dropped);
        var merged = MergeCollinear(emitters
            .Where(item => item.Path.Rooms.Any(room => !dropped.Contains(room)))
            .SelectMany(item => item.Em.Curves));

        string axisAngles = string.Join(",", axes.Select(axis =>
            (Math.Atan2(axis.Y, axis.X) * 180 / Math.PI).ToString("F1", CultureInfo.InvariantCulture)));
        log?.Invoke($"[network] paths={paths.Count} axes={axes.Count}({axisAngles}deg) wallLines={wallLines} " +
                    $"freeRuns={stats.FreeRuns} straightSeams={stats.StraightSeams} " +
                    $"cornerSeams={stats.CornerSeams} unresolvedRuns={stats.UnresolvedRuns} " +
                    $"droppedRooms={dropped.Count} curves={merged.Count}");
        return merged;
    }

    private static void Simplify(PathGeom path, double tolerance)
    {
        path.FitIndex = path.Closed
            ? SimplifyClosed(path.Raw, tolerance)
            : SimplifyOpen(path.Raw, 0, path.Raw.Count - 1, tolerance);
        int segments = path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1;
        path.Lines = new WallLine?[segments];
    }

    // ---- path tracing over the shared cell-edge grid ----

    private static List<PathGeom> TracePaths(IEnumerable<RoomResult> rooms, double cellFt)
    {
        var roomList = rooms.ToList();
        var points = roomList.SelectMany(room => new[] { room.Polygon }.Concat(room.Holes))
            .SelectMany(loop => loop).ToList();
        if (points.Count == 0) return [];
        if (points.Any(point => point.Length < 2 || !IsFinite(point[0]) || !IsFinite(point[1])))
            throw new InvalidOperationException("boundary contains a non-finite point");
        double originX = points.Min(point => point[0]), originY = points.Min(point => point[1]);
        var edges = new HashSet<GridEdge>();
        var edgeRooms = new Dictionary<GridEdge, List<string>>();

        foreach (var room in roomList)
        foreach (var loop in new[] { room.Polygon }.Concat(room.Holes))
        {
            if (loop.Count < 3) throw new InvalidOperationException($"{room.Id} has a degenerate boundary loop");
            for (int i = 0; i < loop.Count; i++) Add(room.Id, loop[i], loop[(i + 1) % loop.Count]);
        }

        var adjacency = new Dictionary<GridPoint, List<GridEdge>>();
        foreach (var edge in edges)
        {
            AddAdjacent(edge.A, edge);
            AddAdjacent(edge.B, edge);
        }

        var unused = edges.ToHashSet();
        var traced = new List<(List<GridPoint> Points, bool Closed, HashSet<string> Rooms)>();
        foreach (var start in adjacency.Where(pair => pair.Value.Count != 2).Select(pair => pair.Key)
                     .OrderBy(point => point.X).ThenBy(point => point.Y))
            foreach (var edge in adjacency[start].OrderBy(edge => edge.A.X).ThenBy(edge => edge.A.Y)
                         .ThenBy(edge => edge.B.X).ThenBy(edge => edge.B.Y))
                if (unused.Contains(edge)) traced.Add(Trace(start, edge, false));
        while (unused.Count > 0)
        {
            var edge = unused.OrderBy(item => item.A.X).ThenBy(item => item.A.Y)
                .ThenBy(item => item.B.X).ThenBy(item => item.B.Y).First();
            traced.Add(Trace(edge.A, edge, true));
        }

        return traced.Select(item => {
            var raw = item.Points;
            bool closed = item.Closed && raw.Count > 3 && raw[0] == raw[^1];
            if (closed) raw.RemoveAt(raw.Count - 1);
            return new PathGeom {
                Raw = raw.Select(point => new Point(originX + point.X * cellFt, originY + point.Y * cellFt))
                    .ToList(),
                FitIndex = [],
                Rooms = item.Rooms,
                Closed = closed,
            };
        }).Where(path => path.Raw.Count >= 2).ToList();

        void Add(string roomId, double[] a, double[] b)
        {
            if (a.Length < 2 || b.Length < 2 || !IsFinite(a[0]) || !IsFinite(a[1])
                || !IsFinite(b[0]) || !IsFinite(b[1]))
                throw new InvalidOperationException($"{roomId} has a non-finite boundary point");
            var ga = Grid(a); var gb = Grid(b);
            bool vertical = ga.X == gb.X;
            if (!vertical && ga.Y != gb.Y)
                throw new InvalidOperationException($"{roomId} has a non-rectilinear boundary edge");
            long dx = Math.Sign(gb.X - ga.X), dy = Math.Sign(gb.Y - ga.Y);
            if (dx == 0 && dy == 0) throw new InvalidOperationException($"{roomId} has a zero-length boundary edge");
            for (var current = ga; current != gb;)
            {
                var next = new GridPoint(current.X + dx, current.Y + dy);
                var edge = Normalize(current, next);
                edges.Add(edge);
                if (!edgeRooms.TryGetValue(edge, out var owners)) edgeRooms[edge] = owners = new List<string>(2);
                if (!owners.Contains(roomId)) owners.Add(roomId);
                current = next;
            }
        }

        GridPoint Grid(double[] point)
        {
            long x = checked((long)Math.Round((point[0] - originX) / cellFt));
            long y = checked((long)Math.Round((point[1] - originY) / cellFt));
            if (Math.Abs(originX + x * cellFt - point[0]) > 1e-4
                || Math.Abs(originY + y * cellFt - point[1]) > 1e-4)
                throw new InvalidOperationException("boundary point is not aligned to the takeoff grid");
            return new GridPoint(x, y);
        }

        void AddAdjacent(GridPoint point, GridEdge edge)
        {
            if (!adjacency.TryGetValue(point, out var list)) adjacency[point] = list = [];
            list.Add(edge);
        }

        (List<GridPoint>, bool, HashSet<string>) Trace(GridPoint start, GridEdge first, bool closed)
        {
            var path = new List<GridPoint> { start };
            var owners = new HashSet<string>(StringComparer.Ordinal);
            var current = start;
            var edge = first;
            while (unused.Remove(edge))
            {
                owners.UnionWith(edgeRooms[edge]);
                current = edge.A == current ? edge.B : edge.A;
                path.Add(current);
                var candidates = adjacency[current].Where(unused.Contains)
                    .OrderBy(item => item.A.X).ThenBy(item => item.A.Y)
                    .ThenBy(item => item.B.X).ThenBy(item => item.B.Y).ToList();
                if (adjacency[current].Count != 2 || candidates.Count == 0) break;
                edge = candidates[0];
            }
            return (path, closed, owners);
        }
    }

    private static GridEdge Normalize(GridPoint a, GridPoint b) => a.X < b.X || a.X == b.X && a.Y <= b.Y
        ? new GridEdge(a, b)
        : new GridEdge(b, a);

    // ---- Douglas-Peucker over Raw indices ----

    private static List<int> SimplifyOpen(List<Point> raw, int first, int last, double tolerance)
    {
        var kept = new List<int> { first };
        Recurse(first, last);
        kept.Add(last);
        return kept;

        void Recurse(int from, int to)
        {
            if (to - from < 2) return;
            int split = -1;
            double farthest = 0;
            for (int i = from + 1; i < to; i++)
            {
                double distance = PerpendicularDistance(raw[i], raw[from], raw[to]);
                if (distance > farthest) { farthest = distance; split = i; }
            }
            if (farthest <= tolerance) return;
            Recurse(from, split);
            kept.Add(split);
            Recurse(split, to);
        }
    }

    private static List<int> SimplifyClosed(List<Point> raw, double tolerance)
    {
        if (raw.Count < 4) return Enumerable.Range(0, raw.Count).ToList();
        // anchor the two halves at the loop's diameter endpoints (true extreme corners) —
        // anchoring at raw[0], an arbitrary mid-wall point, erodes corners at tolerance scale
        // and the tilted segments then contaminate the dominant-axis histogram
        int a = Enumerable.Range(1, raw.Count - 1).OrderByDescending(index => Distance(raw[0], raw[index])).First();
        int b = Enumerable.Range(0, raw.Count).Where(index => index != a)
            .OrderByDescending(index => Distance(raw[a], raw[index])).First();
        if (a > b) (a, b) = (b, a);
        var first = SimplifyOpen(raw, a, b, tolerance);
        // second half wraps through the end back to a; simplify on a rotated copy, then map back
        var wrapped = raw.Skip(b).Concat(raw.Take(a + 1)).ToList();
        var second = SimplifyOpen(wrapped, 0, wrapped.Count - 1, tolerance)
            .Select(index => (b + index) % raw.Count).ToList();
        first.RemoveAt(first.Count - 1);
        second.RemoveAt(second.Count - 1);
        first.AddRange(second);
        return first.Count >= 3 ? first : Enumerable.Range(0, raw.Count).ToList();
    }

    // ---- dominant axes (length-weighted edge-angle histogram folded mod 90 degrees) ----

    private static List<(double X, double Y)> DominantAxes(List<PathGeom> paths)
    {
        var samples = new List<(double Angle, double Weight)>();   // angle in [0, PI/2)
        foreach (var path in paths)
            foreach (var (a, b) in FitSegments(path))
            {
                double dx = b.X - a.X, dy = b.Y - a.Y;
                double length = Math.Sqrt(dx * dx + dy * dy);
                if (length < MinClusterSegmentFt) continue;
                double angle = Math.Atan2(dy, dx) % (Math.PI / 2);
                if (angle < 0) angle += Math.PI / 2;
                samples.Add((angle, length));
            }
        if (samples.Count == 0) return [(1, 0)];

        const int bins = 30;                                       // 3 degrees per bin
        double total = samples.Sum(sample => sample.Weight);
        var histogram = new double[bins];
        foreach (var (angle, weight) in samples)
            histogram[(int)(angle / (Math.PI / 2) * bins) % bins] += weight;

        var axes = new List<(double X, double Y)>();
        foreach (int bin in Enumerable.Range(0, bins)
                     .OrderByDescending(index => histogram[index]).ThenBy(index => index))
        {
            if (axes.Count == 3 || histogram[bin] < 0.05 * total) break;
            double center = (bin + 0.5) / bins * (Math.PI / 2);
            bool NearBin(double angle)
            {
                double delta = Math.Abs(angle - center);
                return Math.Min(delta, Math.PI / 2 - delta) <= 2.5 * (Math.PI / 2) / bins;
            }
            if (axes.Any(axis => {
                    double existing = Math.Atan2(axis.Y, axis.X);
                    double delta = Math.Abs(existing - center);
                    return Math.Min(delta, Math.PI / 2 - delta) < 15 * Math.PI / 180;
                })) continue;
            // refine with the circular mean (angle-quadrupling) of nearby samples
            double sx = 0, sy = 0;
            foreach (var (angle, weight) in samples.Where(sample => NearBin(sample.Angle)))
            {
                sx += weight * Math.Cos(angle * 4);
                sy += weight * Math.Sin(angle * 4);
            }
            double theta = Math.Atan2(sy, sx) / 4;
            if (theta < 0) theta += Math.PI / 2;
            axes.Add((Math.Cos(theta), Math.Sin(theta)));
        }
        return axes.Count > 0 ? axes : [(1, 0)];
    }

    private static IEnumerable<(Point A, Point B)> FitSegments(PathGeom path)
    {
        int segments = path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1;
        for (int i = 0; i < segments; i++)
            yield return (path.Raw[path.FitIndex[i]], path.Raw[path.FitIndex[(i + 1) % path.FitIndex.Count]]);
    }

    // ---- global wall-line consensus ----

    private static int ClusterWallLines(
        List<PathGeom> paths, List<(double X, double Y)> axes, double offsetTolerance)
    {
        double snapTolerance = Math.Sin(SnapToleranceDegrees * Math.PI / 180);
        // family = axis index * 2 + (0 along the axis, 1 along its perpendicular)
        var members = new List<(int Family, double Offset, double Length, PathGeom Path, int Segment)>();
        foreach (var path in paths)
        {
            int index = 0;
            foreach (var (a, b) in FitSegments(path))
            {
                double dx = b.X - a.X, dy = b.Y - a.Y;
                double length = Math.Sqrt(dx * dx + dy * dy);
                if (length >= MinClusterSegmentFt)
                {
                    double ux = dx / length, uy = dy / length;
                    int bestFamily = -1;
                    double bestDeviation = snapTolerance;
                    for (int axis = 0; axis < axes.Count; axis++)
                    {
                        double along = Math.Abs(ux * axes[axis].X + uy * axes[axis].Y);
                        double across = Math.Abs(-ux * axes[axis].Y + uy * axes[axis].X);
                        double deviation = Math.Min(along, across);      // |sin| from nearer direction
                        if (deviation <= bestDeviation)
                        {
                            bestDeviation = deviation;
                            bestFamily = axis * 2 + (along >= across ? 0 : 1);
                        }
                    }
                    if (bestFamily >= 0)
                    {
                        var (nx, ny) = Normal(axes, bestFamily);
                        double mx = (a.X + b.X) / 2, my = (a.Y + b.Y) / 2;
                        members.Add((bestFamily, nx * mx + ny * my, length, path, index));
                    }
                }
                index++;
            }
        }

        int clusters = 0;
        foreach (var group in members.GroupBy(member => member.Family).OrderBy(group => group.Key))
        {
            var ordered = group.OrderBy(member => member.Offset).ToList();
            int start = 0;
            while (start < ordered.Count)
            {
                int end = start;
                while (end + 1 < ordered.Count && ordered[end + 1].Offset - ordered[start].Offset <= offsetTolerance)
                    end++;
                double weight = 0, sum = 0;
                for (int i = start; i <= end; i++)
                {
                    weight += ordered[i].Length;
                    sum += ordered[i].Offset * ordered[i].Length;
                }
                var (nx, ny) = Normal(axes, group.Key);
                var line = new WallLine {
                    Dx = ny, Dy = -nx, Nx = nx, Ny = ny, Offset = sum / weight, Weight = weight,
                };
                for (int i = start; i <= end; i++)
                    ordered[i].Path.Lines[ordered[i].Segment] = line;
                clusters++;
                start = end + 1;
            }
        }
        return clusters;

        static (double Nx, double Ny) Normal(List<(double X, double Y)> axes, int family)
        {
            var axis = axes[family / 2];
            return family % 2 == 0 ? (-axis.Y, axis.X) : (axis.X, axis.Y);
        }
    }

    // ---- weld near-coincident resolved vertices (kills double-dot corners and micro stubs) ----

    private static void WeldVertices(Dictionary<VertexKey, Point> resolved, double weldFt)
    {
        var keys = resolved.Keys.OrderBy(key => key.X).ThenBy(key => key.Y).ToList();
        var cells = new Dictionary<(long X, long Y), List<int>>();
        (long X, long Y) Cell(Point point) =>
            ((long)Math.Floor(point.X / weldFt), (long)Math.Floor(point.Y / weldFt));
        for (int i = 0; i < keys.Count; i++)
        {
            var cell = Cell(resolved[keys[i]]);
            if (!cells.TryGetValue(cell, out var list)) cells[cell] = list = [];
            list.Add(i);
        }

        var parent = Enumerable.Range(0, keys.Count).ToArray();
        int Find(int i) => parent[i] == i ? i : parent[i] = Find(parent[i]);
        for (int i = 0; i < keys.Count; i++)
        {
            var point = resolved[keys[i]];
            var cell = Cell(point);
            for (long dx = -1; dx <= 1; dx++)
                for (long dy = -1; dy <= 1; dy++)
                    if (cells.TryGetValue((cell.X + dx, cell.Y + dy), out var list))
                        foreach (int j in list)
                            if (j < i && Distance(point, resolved[keys[j]]) < weldFt)
                                parent[Find(i)] = Find(j);
        }

        var componentSum = new Dictionary<int, (double X, double Y, int Count)>();
        for (int i = 0; i < keys.Count; i++)
        {
            int root = Find(i);
            var point = resolved[keys[i]];
            var sum = componentSum.GetValueOrDefault(root);
            componentSum[root] = (sum.X + point.X, sum.Y + point.Y, sum.Count + 1);
        }
        for (int i = 0; i < keys.Count; i++)
        {
            var (x, y, count) = componentSum[Find(i)];
            if (count > 1) resolved[keys[i]] = new Point(x / count, y / count);
        }
    }

    private static double Support(List<Point> span, Func<double, double, bool> inkNear) =>
        (double)span.Count(point => inkNear(point.X, point.Y)) / span.Count;

    private static (Point A, Point B) SegmentAt(PathGeom path, int segment)
    {
        var a = path.Raw[path.FitIndex[segment]];
        var b = path.Raw[path.FitIndex[(segment + 1) % path.FitIndex.Count]];
        return (a, b);
    }

    // ---- chamfer collapse: gap-seal corner damage becomes a crisp line x line miter ----

    private static Dictionary<VertexKey, Point> CollapseChamfers(List<PathGeom> paths)
    {
        var forced = new Dictionary<VertexKey, Point>();
        foreach (var path in paths)
        {
            int segments = path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1;
            for (int s = 0; s < segments; s++)
            {
                if (path.Lines[s] != null) continue;
                var (a, b) = SegmentAt(path, s);
                if (Distance(a, b) > MaxChamferFt) continue;
                int previous = s > 0 ? s - 1 : path.Closed ? segments - 1 : -1;
                int next = s < segments - 1 ? s + 1 : path.Closed ? 0 : -1;
                if (previous < 0 || next < 0 || previous == s || next == s) continue;
                var before = path.Lines[previous];
                var after = path.Lines[next];
                if (before == null || after == null
                    || Math.Abs(before.Dx * after.Dy - before.Dy * after.Dx) < 0.34) continue;
                var corner = Intersect(before, after);
                var mid = new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2);
                if (Distance(corner, mid) > MaxChamferFt) continue;
                forced[Key(a)] = corner;
                forced[Key(b)] = corner;
            }
        }
        return forced;
    }

    private static List<Point> RawSpan(PathGeom path, int firstSegment, int segmentCount)
    {
        var span = new List<Point>();
        int rawCount = path.Raw.Count;
        int from = path.FitIndex[firstSegment];
        span.Add(path.Raw[from]);
        for (int s = 0; s < segmentCount; s++)
        {
            int segment = (firstSegment + s) % (path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1);
            int a = path.FitIndex[segment];
            int b = path.FitIndex[(segment + 1) % path.FitIndex.Count];
            for (int i = a; i != b;)
            {
                i = (i + 1) % rawCount;
                span.Add(path.Raw[i]);
                if (!path.Closed && i == rawCount - 1) break;
            }
        }
        return span;
    }

    // ---- vertex re-solve from incident wall lines ----

    private static Dictionary<VertexKey, Point> ResolveVertices(
        List<PathGeom> paths, Dictionary<VertexKey, Point> forced)
    {
        var incidences = new Dictionary<VertexKey, Dictionary<WallLine, double>>();
        var raws = new Dictionary<VertexKey, Point>();
        foreach (var path in paths)
        {
            int segments = path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1;
            for (int s = 0; s < segments; s++)
            {
                var a = path.Raw[path.FitIndex[s]];
                var b = path.Raw[path.FitIndex[(s + 1) % path.FitIndex.Count]];
                double length = Distance(a, b);
                foreach (var point in new[] { a, b })
                {
                    var key = Key(point);
                    if (!incidences.TryGetValue(key, out var incidence))
                    {
                        incidences[key] = incidence = [];
                        raws[key] = point;
                    }
                    if (path.Lines[s] != null)
                        incidence[path.Lines[s]!] = incidence.GetValueOrDefault(path.Lines[s]!) + length;
                }
            }
        }

        var resolved = new Dictionary<VertexKey, Point>();
        foreach (var (key, incidence) in incidences)
        {
            if (forced.TryGetValue(key, out var forcedPoint)) { resolved[key] = forcedPoint; continue; }
            var raw = raws[key];
            var lines = incidence.OrderByDescending(pair => pair.Value)
                .Select(pair => pair.Key).ToList();
            Point candidate = raw;
            if (lines.Count >= 2)
            {
                var second = lines.Skip(1).FirstOrDefault(line =>
                    Math.Abs(lines[0].Dx * line.Dy - lines[0].Dy * line.Dx) > 0.34); // ~20 deg apart
                candidate = second != null ? Intersect(lines[0], second) : Project(raw, lines[0]);
            }
            else if (lines.Count == 1)
                candidate = Project(raw, lines[0]);
            resolved[key] = Distance(candidate, raw) <= MaxVertexShiftFt ? candidate : raw;
        }
        return resolved;
    }

    private static VertexKey Key(Point point) =>
        new((long)Math.Round(point.X * Scale), (long)Math.Round(point.Y * Scale));

    private static Point Project(Point point, WallLine line)
    {
        double shift = line.Offset - (line.Nx * point.X + line.Ny * point.Y);
        return new Point(point.X + line.Nx * shift, point.Y + line.Ny * shift);
    }

    private static Point Intersect(WallLine a, WallLine b)
    {
        double det = a.Nx * b.Ny - a.Ny * b.Nx;
        return new Point((a.Offset * b.Ny - a.Ny * b.Offset) / det,
                         (a.Nx * b.Offset - a.Offset * b.Nx) / det);
    }

    // ---- emit: wall-line runs as single segments, free runs via axis-aligned connectors ----

    private static void EmitPath(
        PathGeom path, Dictionary<VertexKey, Point> resolved, List<(double X, double Y)> axes,
        Func<double, double, bool>? inkNear, Emitter em, NetStats stats)
    {
        int segments = path.Closed ? path.FitIndex.Count : path.FitIndex.Count - 1;
        if (segments == 0) return;

        // rotate closed paths so the walk starts at a primitive boundary
        int start = 0;
        if (path.Closed)
        {
            while (start < segments && ReferenceEquals(path.Lines[start], path.Lines[(start - 1 + segments) % segments]))
                start++;
            if (start == segments)
            {
                // one uniform primitive around the whole loop: emit resolved fit segments
                for (int i = 0; i < path.FitIndex.Count; i++)
                    em.Line(ResolvedAt(path, resolved, i), ResolvedAt(path, resolved, i + 1), "loop");
                if (path.Lines[0] == null)
                {
                    stats.UnresolvedRuns++;
                    em.Dirty = true;
                }
                return;
            }
        }

        double snap = Math.Sin(StraightSeamDegrees * Math.PI / 180);
        var directions = axes.SelectMany(axis => new[] { (X: axis.X, Y: axis.Y), (X: -axis.Y, Y: axis.X) })
            .ToList();
        int index = start, walked = 0;
        while (walked < segments)
        {
            var primitive = path.Lines[index];
            int count = 1;
            while (walked + count < segments
                   && (path.Closed || index + count < segments)
                   && ReferenceEquals(path.Lines[(index + count) % segments], primitive))
                count++;
            var from = ResolvedAt(path, resolved, index);
            var to = ResolvedAt(path, resolved, index + count);
            double dx = to.X - from.X, dy = to.Y - from.Y;
            double length = Math.Sqrt(dx * dx + dy * dy);
            // a wall run must ship on-axis: vertex resolution can pull a short run's endpoint off
            // its consensus line, and the tilted straight segment reads as a fake diagonal. Route
            // it through the same axis-aligned connector machinery as a free run instead.
            bool tilted = length > 1e-6
                          && !directions.Any(u => Math.Abs((dx * u.Y - dy * u.X) / length) <= snap);
            if (primitive != null && !tilted) em.Line(from, to, "wall");
            else
            {
                if (primitive == null) stats.FreeRuns++;
                if (!EmitFreeRun(path, resolved, axes, inkNear, index, count, from, to, em, stats))
                {
                    stats.UnresolvedRuns++;
                    em.Dirty = true;
                }
            }
            index = (index + count) % segments;
            walked += count;
        }
    }

    // A free run is a stretch with no consensus wall line under it: a door opening, an open-plan
    // equidistance seam, or an off-axis/curved wall. Emit it as a straight on-axis seam or an
    // axis-aligned L connector when one fits the raster; otherwise emit the raw fitted polyline
    // and mark the path dirty so its rooms drop as holes.
    private static bool EmitFreeRun(
        PathGeom path, Dictionary<VertexKey, Point> resolved, List<(double X, double Y)> axes,
        Func<double, double, bool>? inkNear, int firstSegment, int segmentCount,
        Point from, Point to, Emitter em, NetStats stats)
    {
        double dx = to.X - from.X, dy = to.Y - from.Y;
        double length = Math.Sqrt(dx * dx + dy * dy);
        if (length < 1e-6) return true;                 // chamfer-collapsed to a crisp corner

        var span = RawSpan(path, firstSegment, segmentCount);
        bool supported = inkNear != null && Support(span, inkNear) >= 0.4;
        double allowance = supported ? SupportedSeamFt : UnsupportedSeamFt;
        var directions = axes.SelectMany(axis => new[] { (X: axis.X, Y: axis.Y), (X: -axis.Y, Y: axis.X) })
            .ToList();

        var candidates = new List<Point[]>();
        double straightSnap = Math.Sin(StraightSeamDegrees * Math.PI / 180);
        if (directions.Any(u => Math.Abs((dx * u.Y - dy * u.X) / length) <= straightSnap))
            candidates.Add([from, to]);
        foreach (var u in directions)
        {
            double along = dx * u.X + dy * u.Y;
            var corner = new Point(from.X + u.X * along, from.Y + u.Y * along);
            candidates.Add([from, corner, to]);
            candidates.Add([from, new Point(from.X + to.X - corner.X, from.Y + to.Y - corner.Y), to]);
        }

        Point[]? best = null;
        double bestCost = double.MaxValue;
        foreach (var candidate in candidates)
        {
            double cost = Deviation(span, candidate);
            foreach (var corner in candidate.Skip(1).Take(candidate.Length - 2))
                cost = Math.Max(cost, span.Min(point => Distance(point, corner)));
            if (cost < bestCost) { bestCost = cost; best = candidate; }
        }
        if (best != null && bestCost <= allowance)
        {
            string tag = best.Length == 2 ? "seam" : "corner";
            for (int i = 1; i < best.Length; i++) em.Line(best[i - 1], best[i], tag);
            if (best.Length == 2) stats.StraightSeams++; else stats.CornerSeams++;
            return true;
        }

        // raster-faithful fitted segments: never ships (the dirty path drops its rooms), but keeps
        // the per-path curve list coherent for diagnostics
        for (int s = 0; s < segmentCount; s++)
        {
            var a = s == 0 ? from : path.Raw[path.FitIndex[(firstSegment + s) % path.FitIndex.Count]];
            var b = s == segmentCount - 1
                ? to
                : path.Raw[path.FitIndex[(firstSegment + s + 1) % path.FitIndex.Count]];
            em.Line(a, b, "fallback");
        }
        return false;
    }

    // Off-axis policy: an emitted segment not aligned to any building direction is acceptable ONLY
    // as part of a supported chain — three or more consecutive off-axis segments over wall ink
    // (a real curved or angled wall traced faithfully). Isolated diagonals (a nub cap, a corner
    // bite, a resolution artifact) and unsupported diagonals mark the path dirty: their rooms
    // drop as holes rather than shipping a shape that bewilders the user.
    private static void ClassifyOffAxis(
        List<(PathGeom Path, Emitter Em)> emitters, List<(double X, double Y)> axes,
        Func<double, double, bool>? inkNear, Action<string>? log)
    {
        double snap = Math.Sin(StraightSeamDegrees * Math.PI / 180);
        var directions = axes.SelectMany(axis => new[] { (X: axis.X, Y: axis.Y), (X: -axis.Y, Y: axis.X) })
            .ToList();
        int chains = 0, isolated = 0;
        foreach (var (path, em) in emitters)
        {
            var offAxis = new bool[em.Curves.Count];
            for (int i = 0; i < em.Curves.Count; i++)
            {
                var c = em.Curves[i];
                double dx = c.X2 - c.X1, dy = c.Y2 - c.Y1;
                double length = Math.Sqrt(dx * dx + dy * dy);
                offAxis[i] = !directions.Any(u => Math.Abs((dx * u.Y - dy * u.X) / length) <= snap);
            }
            int start = 0;
            while (start < offAxis.Length)
            {
                if (!offAxis[start]) { start++; continue; }
                int end = start;
                while (end + 1 < offAxis.Length && offAxis[end + 1]) end++;
                int run = end - start + 1;
                bool supported = inkNear != null && Enumerable.Range(start, run).All(i =>
                    SegmentSupport(em.Curves[i], inkNear) >= 0.5);
                if (run >= 3 && supported) chains++;
                else
                {
                    isolated++;
                    em.Dirty = true;
                    var c = em.Curves[start];
                    log?.Invoke($"[network] offaxis {em.Tags[start]} run={run} sup={(supported ? 1 : 0)} " +
                                $"({c.X1:F1},{c.Y1:F1})->({c.X2:F1},{c.Y2:F1})");
                }
                start = end + 1;
            }
        }
        if (chains + isolated > 0)
            log?.Invoke($"[network] offaxis runs: curveChains={chains} isolatedDirty={isolated}");
    }

    private static double SegmentSupport(BoundaryCurve curve, Func<double, double, bool> inkNear)
    {
        double dx = curve.X2 - curve.X1, dy = curve.Y2 - curve.Y1;
        double length = Math.Sqrt(dx * dx + dy * dy);
        int samples = Math.Max(2, (int)Math.Ceiling(length));
        int hit = 0;
        for (int i = 0; i <= samples; i++)
        {
            double t = (double)i / samples;
            if (inkNear(curve.X1 + dx * t, curve.Y1 + dy * t)) hit++;
        }
        return (double)hit / (samples + 1);
    }

    private static double Deviation(List<Point> span, Point[] polyline)
    {
        double worst = 0;
        foreach (var point in span)
        {
            double nearest = double.MaxValue;
            for (int i = 1; i < polyline.Length; i++)
                nearest = Math.Min(nearest, DistanceToSegment(point, polyline[i - 1], polyline[i]));
            worst = Math.Max(worst, nearest);
        }
        return worst;
    }

    private static double DistanceToSegment(Point point, Point a, Point b)
    {
        double dx = b.X - a.X, dy = b.Y - a.Y;
        double lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1e-18) return Distance(point, a);
        double t = Math.Max(0, Math.Min(1, ((point.X - a.X) * dx + (point.Y - a.Y) * dy) / lengthSq));
        return Distance(point, new Point(a.X + t * dx, a.Y + t * dy));
    }

    private static Point ResolvedAt(PathGeom path, Dictionary<VertexKey, Point> resolved, int fitVertex)
    {
        var raw = path.Raw[path.FitIndex[fitVertex % path.FitIndex.Count]];
        return resolved.TryGetValue(Key(raw), out var value) ? value : raw;
    }

    // ---- merge collinear line intervals across the whole network ----

    private static IReadOnlyList<BoundaryCurve> MergeCollinear(IEnumerable<BoundaryCurve> lines)
    {
        var groups = new Dictionary<LineKey, List<Interval>>();
        foreach (var line in lines)
        {
            double dx = line.X2 - line.X1, dy = line.Y2 - line.Y1;
            double length = Math.Sqrt(dx * dx + dy * dy);
            dx /= length; dy /= length;
            if (dx < -1e-9 || Math.Abs(dx) <= 1e-9 && dy < 0) { dx = -dx; dy = -dy; }
            long qx = (long)Math.Round(dx * Scale), qy = (long)Math.Round(dy * Scale);
            double qLength = Math.Sqrt(qx * qx + qy * qy);
            dx = qx / qLength; dy = qy / qLength;
            long offset = (long)Math.Round((-dy * line.X1 + dx * line.Y1) * Scale);
            long t1 = (long)Math.Round((dx * line.X1 + dy * line.Y1) * Scale);
            long t2 = (long)Math.Round((dx * line.X2 + dy * line.Y2) * Scale);
            var key = new LineKey(qx, qy, offset);
            if (!groups.TryGetValue(key, out var intervals)) groups[key] = intervals = [];
            intervals.Add(new Interval(Math.Min(t1, t2), Math.Max(t1, t2)));
        }

        var result = new List<BoundaryCurve>();
        foreach (var (key, intervals) in groups.OrderBy(pair => pair.Key.Dx)
                     .ThenBy(pair => pair.Key.Dy).ThenBy(pair => pair.Key.Offset))
        {
            var ordered = intervals.OrderBy(interval => interval.Start).ThenBy(interval => interval.End).ToList();
            long start = ordered[0].Start, end = ordered[0].End;
            foreach (var interval in ordered.Skip(1))
                if (interval.Start <= end + 1) end = Math.Max(end, interval.End);
                else { Emit(start, end); start = interval.Start; end = interval.End; }
            Emit(start, end);

            void Emit(long from, long to)
            {
                if (to - from < (long)(0.01 * Scale)) return;   // sub-tolerance dust after merging
                double dx = key.Dx / Scale, dy = key.Dy / Scale;
                double norm = Math.Sqrt(dx * dx + dy * dy);
                dx /= norm; dy /= norm;
                double offset = key.Offset / Scale, t1 = from / Scale, t2 = to / Scale;
                double x1 = dx * t1 - dy * offset, y1 = dy * t1 + dx * offset;
                double x2 = dx * t2 - dy * offset, y2 = dy * t2 + dx * offset;
                result.Add(new BoundaryCurve(x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2, false));
            }
        }
        return result;
    }

    private static double PerpendicularDistance(Point point, Point a, Point b)
    {
        double dx = b.X - a.X, dy = b.Y - a.Y;
        double length = Math.Sqrt(dx * dx + dy * dy);
        return length < 1e-12 ? Distance(point, a)
            : Math.Abs((point.X - a.X) * dy - (point.Y - a.Y) * dx) / length;
    }

    private static double Distance(Point a, Point b)
    {
        double dx = a.X - b.X, dy = a.Y - b.Y;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
