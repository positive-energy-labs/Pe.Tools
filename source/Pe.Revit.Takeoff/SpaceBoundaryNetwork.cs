using NetTopologySuite.Coverage;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;

namespace Pe.Revit.Takeoff;

internal readonly record struct BoundaryCurve(double X1, double Y1, double X2, double Y2);

// Rooms are one polygonal coverage, not independent shapes: simplify them together so an interior
// edge is represented once and both adjacent rooms receive the exact same replacement. No per-room
// repairs or fallback geometries. After simplification the coverage snaps to DOMINANT ORIENTATION
// FRAMES — houses are rectilinear, and DP chords alone ship arbitrary angles that make the
// FilledRegions un-editable by hand.
internal static class SpaceBoundaryNetwork
{
    private const double Scale = TakeoffGeometry.CoverageScale;   // integer key grid == this file's precision model
    private const double Degrees = Math.PI / 180;
    // Snap/frame/run tunables live on TakeoffOptions (Boundary* fields); defaults there are the
    // fan-out-tuned values (snap 35/12), the rest the consts this file always carried.
    private readonly record struct VertexKey(long X, long Y);
    private readonly record struct SegmentKey(VertexKey A, VertexKey B);
    private sealed class WallEdge
    {
        internal required SegmentKey Key;
        internal required Coordinate A;
        internal required Coordinate B;
        internal required double Length;
        internal required double MidX;
        internal required double MidY;
        internal bool Curve;
        internal WallLine? Line;
    }
    private sealed class WallLine
    {
        internal required double Nx;
        internal required double Ny;
        internal double Offset;
    }
    private sealed class Frame
    {
        internal double Angle;                    // [0, PI/2): the frame's base axis, mod 90
        internal double Weight;
        internal double SumSin, SumCos;           // circular mean accumulators, period PI/2
    }
    private static readonly GeometryFactory Factory = TakeoffGeometry.Coverage;

    internal static IReadOnlyList<BoundaryCurve> Build(IEnumerable<RoomResult> rooms)
    {
        var linework = new List<Geometry>();
        foreach (var room in rooms)
        foreach (var loop in new[] { room.Polygon }.Concat(room.Holes))
        {
            var ring = Ring(loop, room.Id);
            for (int i = 1; i < ring.NumPoints; i++)
            {
                var line = Factory.CreateLineString([ring.GetCoordinateN(i - 1), ring.GetCoordinateN(i)]);
                if (line.Length > 0.01) linework.Add(line);
            }
        }
        if (linework.Count == 0) return [];
        var noded = UnaryUnionOp.Union(linework);
        var result = new List<BoundaryCurve>();
        for (int geometryIndex = 0; geometryIndex < noded.NumGeometries; geometryIndex++)
        {
            var line = (LineString)noded.GetGeometryN(geometryIndex);
            for (int pointIndex = 1; pointIndex < line.NumPoints; pointIndex++)
            {
                var a = line.GetCoordinateN(pointIndex - 1);
                var b = line.GetCoordinateN(pointIndex);
                result.Add(new BoundaryCurve(a.X, a.Y, b.X, b.Y));
            }
        }
        return result;
    }

    internal static void Regularize(
        IReadOnlyList<RoomResult> rooms, TakeoffOptions options, Action<string>? log = null)
    {
        if (options == null) throw new ArgumentNullException(nameof(options));
        double simplifyFt = options.BoundarySimplifyFt;
        if (!TakeoffGeometry.IsFinite(simplifyFt) || simplifyFt < 0)
            throw new ArgumentOutOfRangeException(nameof(simplifyFt));
        if (rooms.Count == 0) return;

        Geometry[] source = rooms.Select(ToGeometry).ToArray();

        if (source.Any(room => !room.IsValid) || !CoverageValidator.IsValid(source))
            throw new InvalidOperationException("Detector output is not a valid shared-edge coverage");
        if (simplifyFt == 0) return;
        var sourceAdjacency = SharedEdges(source);
        double sourceArea = source.Sum(room => room.Area);
        double frame = DominantFrame(source);

        double tolerance = simplifyFt;
        for (int attempt = 0; attempt < 5; attempt++, tolerance /= 2)
        {
            var simplified = CoverageSimplifier.Simplify(source, tolerance);
            var snapped = SnapToFrames(simplified, rooms, tolerance, options, log);
            string? debugDir = Environment.GetEnvironmentVariable("PE_TAKEOFF_COVERAGE_DUMP");
            if (debugDir != null)
            {
                Directory.CreateDirectory(debugDir);
                File.WriteAllLines(Path.Combine(debugDir, $"simplified_{tolerance:F3}.wkt"),
                    simplified.Select((geometry, i) => rooms[i].Id + "\t" + geometry));
                File.WriteAllLines(Path.Combine(debugDir, $"snapped_{tolerance:F3}.wkt"),
                    snapped.Select((geometry, i) => rooms[i].Id + "\t" + geometry));
            }
            // a failed snap must not cost the attempt its (good) simplification: fall back to the
            // unsnapped coverage before halving the tolerance toward raw raster
            var simplifiedAdjacency = SharedEdges(simplified);
            Polygon[]? polygons = Accept(snapped, "snapped", simplifiedAdjacency, tolerance);
            if (polygons == null && !ReferenceEquals(snapped, simplified))
                polygons = Accept(simplified, "simplified", sourceAdjacency, tolerance);
            if (polygons == null)
            {
                continue;
            }

            if (attempt == 0)
            {
                double finerTolerance = tolerance / 2;
                var finerSimplified = CoverageSimplifier.Simplify(source, finerTolerance);
                var finerSnapped = SnapToFrames(
                    finerSimplified, rooms, finerTolerance, options, log);
                if (debugDir != null)
                {
                    File.WriteAllLines(Path.Combine(debugDir, $"simplified_{finerTolerance:F3}.wkt"),
                        finerSimplified.Select((geometry, i) => rooms[i].Id + "\t" + geometry));
                    File.WriteAllLines(Path.Combine(debugDir, $"snapped_{finerTolerance:F3}.wkt"),
                        finerSnapped.Select((geometry, i) => rooms[i].Id + "\t" + geometry));
                }
                var finerAdjacency = SharedEdges(finerSimplified);
                var finer = Accept(
                    finerSnapped, "snapped", finerAdjacency, finerTolerance);
                if (finer == null && !ReferenceEquals(finerSnapped, finerSimplified))
                    finer = Accept(
                        finerSimplified, "simplified", sourceAdjacency, finerTolerance);
                if (finer != null)
                {
                    double baselineOffGrid = NonOrthogonalLength(polygons, frame);
                    double finerOffGrid = NonOrthogonalLength(finer, frame);
                    log?.Invoke($"[coverage] regularity tolerance={tolerance:F3}ft " +
                                $"offGrid={baselineOffGrid:F1}ft; " +
                                $"tolerance={finerTolerance:F3}ft offGrid={finerOffGrid:F1}ft");
                    if (PreferFiner(finerOffGrid, baselineOffGrid, tolerance))
                    {
                        polygons = finer;
                        tolerance = finerTolerance;
                    }
                }
            }

            Polygon[]? Accept(
                Geometry[] candidate, string stage, Dictionary<(int A, int B), double> baseline,
                double candidateTolerance)
            {
                bool ogcValid = candidate.All(room => room.IsValid);
                bool coverageValid = ogcValid && CoverageValidator.IsValid(candidate);
                // the law is rooms must TOUCH: gaining adjacency is fine (snapping closes
                // hairline gaps), a shared edge degrading to a corner-point contact is fine
                // (4-corner junctions), but a substantial neighbor pair SEPARATING is not
                bool adjacencyValid = coverageValid && SharedEdges(candidate) is var shared
                    && baseline.Where(pair => pair.Value >= 1.5 && !shared.ContainsKey(pair.Key))
                        .All(pair =>
                            candidate[pair.Key.A].Distance(candidate[pair.Key.B]) <= 0.01);
                bool areaValid = Math.Abs(candidate.Sum(room => room.Area) - sourceArea) <= 0.02 * sourceArea;
                Polygon[] read = [];
                bool labelsValid = ogcValid && TryReadRooms(candidate, rooms, out read);
                if (ogcValid && coverageValid && adjacencyValid && areaValid && labelsValid) return read;
                log?.Invoke($"[coverage] rejected {stage} tolerance={candidateTolerance:F3}ft " +
                            $"ogc={ogcValid} shared={coverageValid} adjacency={adjacencyValid} " +
                            $"area={areaValid} labels={labelsValid}");
                if (!ogcValid && log != null)
                    for (int i = 0; i < candidate.Length; i++)
                    {
                        var error = new NetTopologySuite.Operation.Valid.IsValidOp(candidate[i])
                            .ValidationError;
                        if (error != null)
                            log($"[coverage]   {rooms[i].Id}: {error.Message} at " +
                                $"({error.Coordinate.X:F2},{error.Coordinate.Y:F2})");
                    }
                if (coverageValid && !adjacencyValid && log != null)
                {
                    var shared2 = SharedEdges(candidate);
                    foreach (var pair in baseline.Where(pair =>
                                 pair.Value >= 1.5 && !shared2.ContainsKey(pair.Key)
                                 && candidate[pair.Key.A].Distance(candidate[pair.Key.B]) > 0.01))
                        log($"[coverage]   separated {rooms[pair.Key.A].Id}|" +
                            $"{rooms[pair.Key.B].Id} was {pair.Value:F2}ft shared");
                }
                if (ogcValid && !coverageValid && log != null)
                {
                    var marks = CoverageValidator.Validate(candidate);
                    for (int i = 0; i < marks.Length; i++)
                        if (marks[i] != null && !marks[i].IsEmpty)
                            log($"[coverage]   {rooms[i].Id}: invalid coverage boundary near " +
                                $"({marks[i].Coordinate.X:F2},{marks[i].Coordinate.Y:F2}) " +
                                $"length={marks[i].Length:F2} " +
                                $"wkt={marks[i].ToString()[..Math.Min(300, marks[i].ToString().Length)]}");
                }
                return null;
            }

            double maxDriftPct = 0;
            for (int i = 0; i < rooms.Count; i++)
            {
                var room = rooms[i];
                var polygon = polygons[i];
                room.Polygon = TakeoffGeometry.Points(polygon.ExteriorRing);
                if (TakeoffGeometry.SignedArea(room.Polygon) < 0) room.Polygon.Reverse();
                room.Holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => TakeoffGeometry.Points(polygon.GetInteriorRingN(index))).ToList();
                foreach (var hole in room.Holes)
                    if (TakeoffGeometry.SignedArea(hole) > 0) hole.Reverse();
                room.PerimeterFt = polygon.Length;
                if (room.RawSqft > 0)
                    maxDriftPct = Math.Max(maxDriftPct,
                        100 * Math.Abs(polygon.Area - room.RawSqft) / room.RawSqft);
            }
            log?.Invoke($"[coverage] simplified {rooms.Count} rooms together " +
                        $"tolerance={tolerance:F3}ft maxAreaDrift={maxDriftPct:F1}%");
            return;
        }

        throw new InvalidOperationException("No shared simplification retained every room label");
    }

    // The coverage simplifier owns topology; this stage owns direction. Every straight edge near a
    // dominant orientation frame snaps EXACTLY onto a frame axis; collinear edges share one line so
    // walls have no micro-jogs; each shared vertex moves once from all incident lines so adjacent
    // rooms get identical replacements and corners are exactly 90 degrees. Curve chains (small
    // same-sign turns) and true diagonals beyond the snap tolerance keep their DP chords.
    private static Geometry[] SnapToFrames(
        Geometry[] coverage, IReadOnlyList<RoomResult> rooms, double tolerance,
        TakeoffOptions options, Action<string>? log)
    {
        double SnapToleranceDeg = options.BoundarySnapToleranceDeg;
        double SnapShortDeg = options.BoundarySnapShortDeg;
        double SnapShortFt = options.BoundarySnapShortFt;
        double SnapMinFt = options.BoundarySnapMinFt;
        double FrameClusterDeg = options.BoundaryFrameClusterDeg;
        double FrameMinShare = options.BoundaryFrameMinShare;
        double RunGapFt = options.BoundaryRunGapFt;
        double RunSpanFt = options.BoundaryRunSpanFt;
        var edges = UniqueEdges(coverage);
        var curves = CurveChainEdges(coverage);
        foreach (var edge in edges.Values) edge.Curve = curves.Contains(edge.Key);
        var straight = edges.Values
            .Where(edge => !edge.Curve && edge.Length >= SnapMinFt).ToList();
        if (straight.Count == 0) return coverage;

        var frames = new List<Frame>();
        foreach (var edge in straight.OrderByDescending(edge => edge.Length))
        {
            double angle = NormalizeAngle90(EdgeAngle(edge));
            var frame = frames.FirstOrDefault(candidate =>
                Difference90(candidate.Angle, angle) <= FrameClusterDeg * Degrees);
            if (frame == null) frames.Add(frame = new Frame());
            frame.Weight += edge.Length;
            frame.SumSin += edge.Length * Math.Sin(4 * angle);
            frame.SumCos += edge.Length * Math.Cos(4 * angle);
            frame.Angle = NormalizeAngle90(0.25 * Math.Atan2(frame.SumSin, frame.SumCos));
        }
        double totalWeight = straight.Sum(edge => edge.Length);
        var kept = frames.Where(frame =>
            frame.Weight >= Math.Max(12, FrameMinShare * totalWeight)).ToList();
        if (kept.Count == 0) return coverage;
        foreach (var frame in kept)
        {
            // buildings are usually modeled on the project axes; do not let chord noise hold a
            // whole frame a fraction of a degree off a clean 0/45/90
            double nearest = Math.Round(frame.Angle / (45 * Degrees)) * 45 * Degrees;
            if (Math.Abs(frame.Angle - nearest) <= 1 * Degrees) frame.Angle = NormalizeAngle90(nearest);
        }

        // per-edge axis assignment, then collinear runs share a single length-weighted line
        var groups = new Dictionary<(Frame Frame, int Axis), List<WallEdge>>();
        foreach (var edge in straight)
        {
            double angle = EdgeAngle(edge);
            var best = kept.OrderBy(frame => Difference90(frame.Angle, angle)).First();
            double snapTolerance =
                (edge.Length >= SnapShortFt ? SnapToleranceDeg : SnapShortDeg) * Degrees;
            if (Difference90(best.Angle, angle) > snapTolerance) continue;
            int axis = AngleDifference(angle, best.Angle) <=
                       AngleDifference(angle, best.Angle + Math.PI / 2) ? 0 : 1;
            if (!groups.TryGetValue((best, axis), out var members))
                groups[(best, axis)] = members = [];
            members.Add(edge);
        }
        if (groups.Count == 0) return coverage;

        int runs = 0;
        foreach (var ((frame, axis), members) in groups)
        {
            double direction = frame.Angle + axis * Math.PI / 2;
            double nx = -Math.Sin(direction), ny = Math.Cos(direction);
            List<WallEdge>? run = null;
            double previous = double.NegativeInfinity, first = double.NegativeInfinity;
            foreach (var edge in members.OrderBy(edge => nx * edge.MidX + ny * edge.MidY))
            {
                double offset = nx * edge.MidX + ny * edge.MidY;
                if (run == null || offset - previous > RunGapFt || offset - first > RunSpanFt)
                {
                    Commit(run);
                    run = [];
                    runs++;
                    first = offset;
                }
                run.Add(edge);
                previous = offset;
            }
            Commit(run);

            void Commit(List<WallEdge>? committed)
            {
                if (committed == null) return;
                double weight = committed.Sum(edge => edge.Length);
                var line = new WallLine {
                    Nx = nx, Ny = ny,
                    Offset = committed.Sum(edge =>
                        edge.Length * (nx * edge.MidX + ny * edge.MidY)) / weight,
                };
                foreach (var edge in committed) edge.Line = line;
            }
        }

        var moved = ResolveVertices(edges.Values, tolerance);
        int snapped = straight.Count(edge => edge.Line != null);

        // Rebuild the coverage from the moved edge graph instead of moving rings in place: noding
        // turns folds/overlaps/collapsed jogs into ordinary nodes, polygonizing yields exactly-noded
        // faces, label points hand each face to its room. Unlabeled faces inside the footprint are
        // absorbed by their longest-shared assigned neighbor; faces outside it are dropped.
        var segments = new List<Geometry>();
        foreach (var edge in edges.Values)
        {
            var a = moved.TryGetValue(Key(edge.A), out var movedA) ? movedA : edge.A;
            var b = moved.TryGetValue(Key(edge.B), out var movedB) ? movedB : edge.B;
            if (Key(a) == Key(b)) continue;
            segments.Add(Factory.CreateLineString([a.Copy(), b.Copy()]));
        }
        var polygonizer = new NetTopologySuite.Operation.Polygonize.Polygonizer();
        polygonizer.Add(UnaryUnionOp.Union(segments));
        var faces = polygonizer.GetPolygons().Cast<Polygon>().ToList();

        var owner = new int[faces.Count];
        for (int i = 0; i < owner.Length; i++) owner[i] = -1;
        for (int roomIndex = 0; roomIndex < rooms.Count; roomIndex++)
        {
            var label = Factory.CreatePoint(
                new Coordinate(rooms[roomIndex].LabelX, rooms[roomIndex].LabelY));
            int face = faces.FindIndex(candidate => candidate.Contains(label));
            if (face < 0 || owner[face] >= 0) return coverage; // a room collapsed: snap unusable
            owner[face] = roomIndex;
        }

        var footprint = NetTopologySuite.Geometries.Prepared.PreparedGeometryFactory
            .Prepare(UnaryUnionOp.Union(coverage));
        int absorbed = 0, droppedFaces = 0;
        for (int round = 0; round < 6; round++)
        {
            bool changed = false;
            for (int face = 0; face < faces.Count; face++)
            {
                if (owner[face] != -1) continue;
                if (!footprint.Covers(faces[face].InteriorPoint))
                {
                    owner[face] = -2;
                    droppedFaces++;
                    continue;
                }
                int bestNeighbor = -1;
                double bestShared = 0;
                for (int other = 0; other < faces.Count; other++)
                {
                    if (owner[other] < 0 || other == face
                        || !faces[face].EnvelopeInternal.Intersects(faces[other].EnvelopeInternal))
                        continue;
                    double sharedLength =
                        faces[face].Boundary.Intersection(faces[other].Boundary).Length;
                    if (sharedLength > bestShared)
                    {
                        bestShared = sharedLength;
                        bestNeighbor = other;
                    }
                }
                if (bestNeighbor < 0) continue;
                owner[face] = owner[bestNeighbor];
                absorbed++;
                changed = true;
            }
            if (!changed) break;
        }

        var result = new Geometry[coverage.Length];
        for (int roomIndex = 0; roomIndex < coverage.Length; roomIndex++)
        {
            var mine = Enumerable.Range(0, faces.Count)
                .Where(face => owner[face] == roomIndex)
                .Select(face => (Geometry)faces[face]).ToList();
            if (mine.Count == 0) return coverage;
            var union = mine.Count == 1 ? mine[0] : UnaryUnionOp.Union(mine);
            // the TSV serializes at 1e-6: snap-round NOW so the gates judge exactly what
            // ships (near-coincident doubles otherwise collapse into spikes on re-parse)
            union = NetTopologySuite.Precision.GeometryPrecisionReducer.Reduce(
                union, Factory.PrecisionModel);
            if (union is not Polygon) return coverage; // disconnected room: snap unusable
            result[roomIndex] = union;
        }

        log?.Invoke($"[coverage] frames=({string.Join(",", kept.Select(frame =>
                        (frame.Angle / Degrees).ToString("F2", CultureInfo.InvariantCulture)))})deg " +
                    $"snapped={snapped}/{edges.Count} runs={runs} curveEdges={curves.Count} " +
                    $"faces={faces.Count} absorbed={absorbed} dropped={droppedFaces}");
        return result;
    }

    // A run of >= 3 consecutive edges turning the same way by small angles is a curve (or a
    // deliberate chamfer fan); its chords must not be snapped into stairsteps.
    private static HashSet<SegmentKey> CurveChainEdges(IEnumerable<Geometry> coverage)
    {
        var result = new HashSet<SegmentKey>();
        foreach (var polygon in coverage.Cast<Polygon>())
        {
            Mark(polygon.ExteriorRing);
            for (int i = 0; i < polygon.NumInteriorRings; i++) Mark(polygon.GetInteriorRingN(i));
        }
        return result;

        void Mark(LineString ring)
        {
            int count = ring.NumPoints - 1;
            if (count < 4) return;
            var chain = new List<int>();
            int sign = 0;
            for (int i = 0; i <= count; i++)
            {
                var a = ring.GetCoordinateN(((i - 1) % count + count) % count);
                var b = ring.GetCoordinateN(i % count);
                var c = ring.GetCoordinateN((i + 1) % count);
                double turn = NormalizeTurn(
                    Math.Atan2(c.Y - b.Y, c.X - b.X) - Math.Atan2(b.Y - a.Y, b.X - a.X));
                double magnitude = Math.Abs(turn);
                int turnSign = magnitude >= 8 * Degrees && magnitude <= 50 * Degrees
                    ? Math.Sign(turn) : 0;
                if (turnSign != 0 && turnSign == sign) { chain.Add(i % count); continue; }
                Flush();
                sign = turnSign;
                if (turnSign != 0) chain.Add(i % count);
            }
            Flush();

            void Flush()
            {
                // n consecutive qualifying vertices join n+1 edges; require >= 3 edges
                if (chain.Count >= 2)
                    for (int j = -1; j < chain.Count; j++)
                    {
                        int vertex = j < 0 ? chain[0] - 1 : chain[j];
                        int from = ((vertex % count) + count) % count;
                        result.Add(Segment(ring.GetCoordinateN(from),
                                           ring.GetCoordinateN((from + 1) % count)));
                    }
                chain.Clear();
            }
        }
    }

    private static double NormalizeTurn(double turn)
    {
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        return turn;
    }

    private static Dictionary<(int A, int B), double> SharedEdges(IReadOnlyList<Geometry> rooms)
    {
        var result = new Dictionary<(int, int), double>();
        for (int i = 0; i < rooms.Count; i++)
        for (int j = i + 1; j < rooms.Count; j++)
        {
            if (!rooms[i].EnvelopeInternal.Intersects(rooms[j].EnvelopeInternal)) continue;
            double length = rooms[i].Boundary.Intersection(rooms[j].Boundary).Length;
            if (length > 0.01) result[(i, j)] = length;
        }
        return result;
    }

    private static Dictionary<SegmentKey, WallEdge> UniqueEdges(IEnumerable<Geometry> coverage)
    {
        var result = new Dictionary<SegmentKey, WallEdge>();
        foreach (var polygon in coverage.Cast<Polygon>())
        {
            Add(polygon.ExteriorRing);
            for (int i = 0; i < polygon.NumInteriorRings; i++) Add(polygon.GetInteriorRingN(i));
        }
        return result;

        void Add(LineString ring)
        {
            for (int i = 1; i < ring.NumPoints; i++)
            {
                var a = ring.GetCoordinateN(i - 1);
                var b = ring.GetCoordinateN(i);
                var key = Segment(a, b);
                if (result.ContainsKey(key)) continue;
                double length = Distance(a.X, a.Y, b.X, b.Y);
                if (length <= 0) continue;
                result[key] = new WallEdge {
                    Key = key, A = a.Copy(), B = b.Copy(), Length = length,
                    MidX = (a.X + b.X) / 2, MidY = (a.Y + b.Y) / 2,
                };
            }
        }
    }

    private static Dictionary<VertexKey, Coordinate> ResolveVertices(
        IEnumerable<WallEdge> allEdges, double tolerance)
    {
        var edges = allEdges.ToList();
        var incidences = new Dictionary<VertexKey, Dictionary<WallLine, double>>();
        var originals = new Dictionary<VertexKey, Coordinate>();
        foreach (var edge in edges.Where(edge => edge.Line != null))
        foreach (var point in new[] { edge.A, edge.B })
        {
            var key = Key(point);
            originals[key] = point;
            if (!incidences.TryGetValue(key, out var lines)) incidences[key] = lines = [];
            lines[edge.Line!] = lines.GetValueOrDefault(edge.Line!) + edge.Length;
        }

        // a short free edge between two snapped walls is a DP corner bevel, not architecture:
        // give both its endpoints the union of incident lines so the bevel collapses into the
        // corner intersection (real chamfers are longer and survive)
        foreach (var edge in edges.Where(edge =>
                     edge.Line == null && !edge.Curve && edge.Length <= 0.75 * tolerance))
        {
            var ka = Key(edge.A); var kb = Key(edge.B);
            var union = new Dictionary<WallLine, double>();
            foreach (var key in new[] { ka, kb })
                if (incidences.TryGetValue(key, out var lines))
                    foreach (var (line, weight) in lines)
                        union[line] = union.GetValueOrDefault(line) + weight;
            if (union.Count == 0) continue;
            originals[ka] = edge.A;
            originals[kb] = edge.B;
            incidences[ka] = union;
            incidences[kb] = union;
        }

        var result = new Dictionary<VertexKey, Coordinate>();
        double maxShift = Math.Max(0.6, 0.375 * tolerance);
        // ponytail: single per-vertex least-squares; a global snap-solver is the upgrade path
        foreach (var (key, weighted) in incidences)
        {
            var original = originals[key];
            var lines = weighted.OrderByDescending(pair => pair.Value).Select(pair => pair.Key).ToList();
            Coordinate candidate;
            if (lines.Count >= 2 && TryIntersect(lines, out candidate)) { }
            else candidate = Project(original, lines[0]);
            if (Distance(original.X, original.Y, candidate.X, candidate.Y) <= maxShift)
                result[key] = candidate;
        }

        return result;
    }

    private static bool TryIntersect(IReadOnlyList<WallLine> lines, out Coordinate point)
    {
        double xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
        foreach (var line in lines)
        {
            xx += line.Nx * line.Nx;
            xy += line.Nx * line.Ny;
            yy += line.Ny * line.Ny;
            bx += line.Offset * line.Nx;
            by += line.Offset * line.Ny;
        }
        double determinant = xx * yy - xy * xy;
        if (determinant <= 0.03)
        {
            point = new Coordinate();
            return false;
        }
        point = new Coordinate((bx * yy - by * xy) / determinant,
                               (by * xx - bx * xy) / determinant);
        return true;
    }

    private static Coordinate Project(Coordinate point, WallLine line)
    {
        double shift = line.Offset - line.Nx * point.X - line.Ny * point.Y;
        return new Coordinate(point.X + line.Nx * shift, point.Y + line.Ny * shift);
    }

    private static double EdgeAngle(WallEdge edge) =>
        NormalizeAngle(Math.Atan2(edge.B.Y - edge.A.Y, edge.B.X - edge.A.X));

    private static double DominantFrame(IEnumerable<Geometry> coverage)
    {
        var edges = UniqueEdges(coverage).Values;
        double sumSin = edges.Sum(edge => edge.Length * Math.Sin(4 * EdgeAngle(edge)));
        double sumCos = edges.Sum(edge => edge.Length * Math.Cos(4 * EdgeAngle(edge)));
        return NormalizeAngle90(0.25 * Math.Atan2(sumSin, sumCos));
    }

    private static double NonOrthogonalLength(IEnumerable<Geometry> coverage, double frame) =>
        UniqueEdges(coverage).Values.Where(edge =>
        {
            double offAxis = Difference90(EdgeAngle(edge), frame);
            return Math.Min(offAxis, Math.Abs(Math.PI / 4 - offAxis)) > 3 * Degrees;
        }).Sum(edge => edge.Length);

    internal static bool PreferFiner(double finerOffGrid, double baselineOffGrid, double tolerance) =>
        finerOffGrid <= baselineOffGrid / 2
        && baselineOffGrid - finerOffGrid >= 10 * tolerance;

    private static double NormalizeAngle(double angle)
    {
        angle %= Math.PI;
        return angle < 0 ? angle + Math.PI : angle;
    }

    private static double NormalizeAngle90(double angle)
    {
        angle %= Math.PI / 2;
        return angle < 0 ? angle + Math.PI / 2 : angle;
    }

    private static double AngleDifference(double a, double b)
    {
        double difference = Math.Abs(NormalizeAngle(a) - NormalizeAngle(b));
        return Math.Min(difference, Math.PI - difference);
    }

    private static double Difference90(double a, double b)
    {
        double difference = Math.Abs(NormalizeAngle90(a) - NormalizeAngle90(b));
        return Math.Min(difference, Math.PI / 2 - difference);
    }

    private static VertexKey Key(Coordinate point) =>
        new((long)Math.Round(point.X * Scale), (long)Math.Round(point.Y * Scale));

    private static SegmentKey Segment(Coordinate a, Coordinate b)
    {
        var ka = Key(a); var kb = Key(b);
        return ka.X < kb.X || ka.X == kb.X && ka.Y <= kb.Y
            ? new SegmentKey(ka, kb) : new SegmentKey(kb, ka);
    }

    private static double Distance(double ax, double ay, double bx, double by)
    {
        double dx = ax - bx, dy = ay - by;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    private static Geometry ToGeometry(RoomResult room) =>
        TakeoffGeometry.ToPolygon(room, Factory);

    private static bool TryReadRooms(
        IReadOnlyList<Geometry> geometries, IReadOnlyList<RoomResult> rooms,
        out Polygon[] polygons)
    {
        polygons = new Polygon[geometries.Count];
        for (int i = 0; i < geometries.Count; i++)
        {
            var label = Factory.CreatePoint(new Coordinate(rooms[i].LabelX, rooms[i].LabelY));
            if (geometries[i] is not Polygon polygon || !polygon.Contains(label)
                || polygon.Boundary.Distance(label) <= 0.01)
                return false;
            polygons[i] = polygon;
        }
        return true;
    }

    private static LinearRing Ring(IReadOnlyList<double[]> points, string owner) =>
        TakeoffGeometry.Ring(points, Factory, owner);

}
