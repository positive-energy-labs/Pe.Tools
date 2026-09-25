using Pe.Revit.Space;
using Pe.Revit.Compat;
using Pe.Revit.Extensions.ProjDocument;
using ArchitecturalRoom = Autodesk.Revit.DB.Architecture.Room;
using SpaceVerbs = Pe.Revit.Space.Verbs;

namespace Pe.Revit.Partition;

/// <summary>
///     The Revit adapter: resolves the level and the Zoning Region loop, calls
///     <c>Space.Verbs.Slice</c> for the two bands and <c>Space.Verbs.Probe</c> per face, and hands
///     the result to <see cref="Solve" />. Stages 1, 2 and 6 live here; the algorithm never does.
///     Read only — the solver never writes to the document.
/// </summary>
public static class Verbs {
    // FOOTGUN: band offsets from ProjectElevation. The same cuts every line of the takeoff-geom
    // fan-out used, SHAPE.md stage 1. Constants, not knobs.
    private const double KneeLoFt = 3.5;
    private const double KneeHiFt = 4.5;
    private const double HeaderLoFt = 8.0;
    private const double HeaderHiFt = 9.0;

    // FOOTGUN: xy clip margin around the zone loop, SHAPE.md stage 2.
    private const double ClipMarginFt = 2.0;

    // FOOTGUN: curve tessellation for a non-linear zone boundary segment.
    private const double LoopTolFt = 1e-9;

    public static PartitionAnswer Partition(Document document, PartitionRequest request) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = Run(document, Capture(document, request));
        return result with { Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 3) };
    }

    /// <summary>Solve an already captured input; callers that need the captured slices capture first.</summary>
    public static PartitionAnswer Run(Document document, PartitionInput input) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        ProbeAnswer Probe(double x, double y) {
            var answer = SpaceVerbs.Probe(document, new XYZ(x, y, input.LevelZ + KneeLoFt), purpose: ProbePurpose.RoomHeights);
            RequireStamp(answer.Stamp, input.Knee.Stamp, document.GetDocumentKey(), "probe");
            return answer;
        }

        var result = Solve.RunRails(input, Probe);
        RequireCurrent(document, input.Knee.Stamp);
        sw.Stop();
        return result with { Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 3) };
    }

    /// <summary>Read actual Space slices and native Room proposals without running or materializing a solve.</summary>
    public static PartitionInput Capture(Document document, PartitionRequest request) {
        var knobs = request.Knobs ?? Knobs.Default;
        if (new[] { knobs.InkHalfWidthFt, knobs.CloseFt, knobs.FloorTolFt, knobs.MinHeadroomFt,
                knobs.MinRoomSqft, knobs.MinFeatureWidthFt, knobs.InkBackedAcceptMin }
            .Any(v => !Finite(v) || v < 0)
            || knobs.InkHalfWidthFt == 0 || knobs.InkBackedAcceptMin > 1)
            throw new PartitionException("malformed capture: invalid partition knobs");

        // Stage 1, scope. The Zoning Region is a FilledRegion; its loop is the domain and the
        // accounting denominator, and its level comes from the view it is drawn on.
        double[][] loops;
        View view;
        Level level;
        if (request.Loops is { } given) {
            // Level scope: the caller's loops are the domain; the plan view gives level and phase.
            if (request.View is not { } viewId || document.GetElement(viewId.ToElementId()) is not ViewPlan plan
                || plan.IsTemplate || plan.GenLevel is null)
                throw new PartitionException($"view {request.View} is not a non-template ViewPlan with a level");
            if (given.Length == 0 || given.Any(l => l is null || l.Length < 6 || l.Length % 2 != 0 || l.Any(v => !Finite(v))))
                throw new PartitionException("malformed capture: domain loops must be finite x,y rings of three or more points");
            loops = given;
            view = plan;
            level = plan.GenLevel;
        } else {
            if (document.GetElement(request.ZoneRegion.ToElementId()) is not FilledRegion region)
                throw new PartitionException($"element {request.ZoneRegion} is not a FilledRegion");

            loops = region.GetBoundaries().Select(cl => Loop(cl, Transform.Identity, $"zone {region.Id}")).ToArray();
            if (loops.Length == 0) throw new PartitionException($"malformed capture: zone {region.Id} has no boundaries");
            view = document.GetElement(region.OwnerViewId) as View
                ?? throw new PartitionException($"malformed capture: zone {region.Id} has no owner view");
            level = view.GenLevel ?? document.GetElement(region.LevelId) as Level
                ?? throw new PartitionException($"malformed capture: zone {region.Id} resolves to no level");
        }
        var levelZ = level.ProjectElevation;
        if (!Finite(levelZ)) throw new PartitionException("malformed capture: nonfinite level elevation");
        var phaseId = PhaseId(view, BuiltInParameter.VIEW_PHASE);

        double minx = double.MaxValue, miny = double.MaxValue, maxx = double.MinValue, maxy = double.MinValue;
        foreach (var loop in loops)
            for (var i = 0; i < loop.Length; i += 2) {
                minx = Math.Min(minx, loop[i]); maxx = Math.Max(maxx, loop[i]);
                miny = Math.Min(miny, loop[i + 1]); maxy = Math.Max(maxy, loop[i + 1]);
            }

        var clip = new Aabb(minx - ClipMarginFt, miny - ClipMarginFt, 0, maxx + ClipMarginFt, maxy + ClipMarginFt, 0);

        // Enclosure is declared per document, never inferred. The reason travels into the answer.
        var (declared, source) = request.Enclosure is null
            ? EnclosureDeclaration.Read(document)
            : (request.Enclosure, "request: caller supplied the enclosure");

        // Stage 2, slice. Two calls per band, because Filter.Wants is a conjunction and
        // (sources AND categories AND Solid|Mesh) OR (Curve2D AND layers) is not one filter.
        var knee = Band(document, levelZ + KneeLoFt, levelZ + KneeHiFt, declared, clip);
        var header = Band(document, levelZ + HeaderLoFt, levelZ + HeaderHiFt, declared, clip);
        RequireStamp(header.Solids.Stamp, knee.Solids.Stamp, document.GetDocumentKey(), "header");
        var gates = new[] { knee.Solids.Stamp.Resolved, knee.Ribbons.Stamp.Resolved,
            header.Solids.Stamp.Resolved, header.Ribbons.Stamp.Resolved };
        var originalKnee = SpaceVerbs.OriginalCurves(document, levelZ + KneeLoFt, levelZ + KneeHiFt, clip, declared.Ribbons);
        var originalHeader = SpaceVerbs.OriginalCurves(document, levelZ + HeaderLoFt, levelZ + HeaderHiFt, clip, declared.Ribbons);
        RequireStamp(originalKnee.Stamp, knee.Solids.Stamp, document.GetDocumentKey(), "original knee curves");
        RequireStamp(originalHeader.Stamp, knee.Solids.Stamp, document.GetDocumentKey(), "original header curves");
        var proposals = Proposals(document, level, phaseId, knee.Solids.Stamp, clip);
        RequireCurrent(document, knee.Solids.Stamp);
        return new PartitionInput(knee.Merged, header.Merged, loops, levelZ, knobs, gates, source, proposals,
            new OriginalCurveEvidence(originalKnee, originalHeader));
    }

    // ---------------------------------------------------------------- stage 1

    private static double[] Loop(IEnumerable<Curve> curves, Transform transform, string owner) {
        var points = new List<double>();
        XYZ? first = null, last = null;
        foreach (var curve in curves) {
            var vertices = curve.Tessellate();
            if (vertices.Count < 2 || (last is not null && last.DistanceTo(transform.OfPoint(vertices[0])) > LoopTolFt))
                throw new PartitionException($"malformed capture: disconnected boundary for {owner}");
            foreach (var vertex in vertices) {
                var p = transform.OfPoint(vertex);
                if (!Finite(p.X) || !Finite(p.Y) || !Finite(p.Z))
                    throw new PartitionException($"malformed capture: nonfinite boundary for {owner}");
                first ??= p;
                last = p;
                if (points.Count >= 2 && Math.Abs(points[^2] - p.X) < LoopTolFt
                    && Math.Abs(points[^1] - p.Y) < LoopTolFt) continue;
                points.Add(p.X);
                points.Add(p.Y);
            }
        }
        if (first is null || last is null || first.DistanceTo(last) > LoopTolFt || points.Count < 8)
            throw new PartitionException($"malformed capture: open or empty boundary for {owner}");
        points.RemoveRange(points.Count - 2, 2);
        return points.ToArray();
    }

    private static ElementId PhaseId(Element element, BuiltInParameter parameter) {
        var p = element.get_Parameter(parameter);
        if (p is null || p.StorageType != StorageType.ElementId
            || element.Document.GetElement(p.AsElementId()) is not Phase phase)
            throw new PartitionException($"malformed capture: {element.Id} has no valid {parameter}");
        return phase.Id;
    }

    private static IReadOnlyList<RoomProposal> Proposals(Document host, Level level, ElementId phase, Stamp stamp, Aabb clip) {
        var result = new List<RoomProposal>();
        Collect(host, null, Transform.Identity);
        var sources = 1;
        foreach (var link in new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance))
                     .Cast<RevitLinkInstance>().OrderBy(l => l.UniqueId, StringComparer.Ordinal)) {
            var doc = link.GetLinkDocument();
            if (doc is null) continue; // Scope is loaded direct links; no nested-link traversal.
            sources++;
            Collect(doc, link, link.GetTotalTransform());
        }
        if (stamp.Sources.Count != sources)
            throw new PartitionException("stale capture: loaded source inventory differs from Space build");
        return result;

        void Collect(Document doc, RevitLinkInstance? link, Transform transform) {
            var documentKey = doc.GetDocumentKey();
            var linkId = link?.Id.Value();
            if (!stamp.Sources.Any(s => s.DocumentKey == documentKey && s.LinkInstanceId == linkId && !s.Dirty))
                throw new PartitionException($"stale capture: source {documentKey}, link {linkId} is absent or dirty");
            var rooms = new FilteredElementCollector(doc).WherePasses(new Autodesk.Revit.DB.Architecture.RoomFilter())
                .Cast<ArchitecturalRoom>().Where(r => r.Location is not null && InScope(r, transform))
                .OrderBy(r => r.UniqueId, StringComparer.Ordinal).ToList();
            if (rooms.Count == 0) return; // Unplaced Rooms have no spatial proposal or phase-mapping requirement.
            var sourcePhase = phase;
            if (link is not null) {
                if (host.GetElement(link.GetTypeId()) is not RevitLinkType type)
                    throw new PartitionException($"malformed capture: link {link.Id} has no RevitLinkType");
                var map = type.GetPhaseMap();
                if (!map.TryGetValue(phase, out sourcePhase) || doc.GetElement(sourcePhase) is not Phase)
                    throw new PartitionException($"ineligible capture: link {link.Id} has no mapping for host phase {phase}");
            }
            if (Math.Abs(transform.BasisX.Z) > LoopTolFt || Math.Abs(transform.BasisY.Z) > LoopTolFt)
                throw new PartitionException($"ineligible capture: link {linkId} does not preserve horizontal level planes");
            using var options = new SpatialElementBoundaryOptions {
                SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Center
            };
            foreach (var room in rooms) {
                if (PhaseId(room, BuiltInParameter.ROOM_PHASE_ID) != sourcePhase) continue;
                if (room.Level is not { } roomLevel)
                    throw new PartitionException($"malformed capture: Room {room.UniqueId} has no level");
                var hostZ = transform.OfPoint(new XYZ(0, 0, roomLevel.ProjectElevation)).Z;
                if (!Finite(hostZ))
                    throw new PartitionException($"malformed capture: Room {room.UniqueId} has nonfinite transformed level");
                if (link is null ? roomLevel.Id != level.Id : Math.Abs(hostZ - level.ProjectElevation) > LoopTolFt)
                    continue;
                // The host plus link instance resolves the source even when Revit gives a loaded link no path.
                var key = $"{Uri.EscapeDataString(stamp.HostDocumentKey)}|{Uri.EscapeDataString(link?.UniqueId ?? "host")}|{Uri.EscapeDataString(room.UniqueId)}";
                var boundaries = room.GetBoundarySegments(options);
                var loops = boundaries?.Select(b => Loop(b.Select(s => s.GetCurve()), transform, key)).ToArray() ?? [];
                // Empty, self-intersecting, or conflicting proposal topology belongs to Solve; do not repair or drop it here.
                result.Add(new RoomProposal(key, room.Name, room.Number, loops));
            }
        }

        bool InScope(ArchitecturalRoom room, Transform transform) {
            if (room.get_BoundingBox(null) is not { } box) return true;
            var corners = (from x in new[] { box.Min.X, box.Max.X }
                           from y in new[] { box.Min.Y, box.Max.Y }
                           from z in new[] { box.Min.Z, box.Max.Z }
                           select transform.OfPoint(box.Transform.OfPoint(new XYZ(x, y, z)))).ToArray();
            return corners.Min(p => p.X) <= clip.MaxX && corners.Max(p => p.X) >= clip.MinX
                && corners.Min(p => p.Y) <= clip.MaxY && corners.Max(p => p.Y) >= clip.MinY;
        }
    }

    private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    private static void RequireStamp(Stamp stamp, Stamp expected, string hostKey, string stage) {
        if (!stamp.Fresh || stamp.BuiltUtc == default)
            throw new PartitionException($"stale capture: {stage} Space evidence is unbuilt or dirty");
        if (stamp.HostDocumentKey != hostKey || stamp.Frame != Stamp.HostInternalFt)
            throw new PartitionException($"malformed capture: {stage} document or coordinate frame mismatch");
        if (stamp.Epoch != expected.Epoch || stamp.BuiltUtc != expected.BuiltUtc
            || !stamp.Sources.SequenceEqual(expected.Sources))
            throw new PartitionException($"stale capture: {stage} Space evidence changed during capture");
    }

    private static void RequireCurrent(Document document, Stamp stamp) {
        var world = SpaceWorld.Resident(document);
        if (world.CurrentEpoch != stamp.Epoch || world.BuiltUtc != stamp.BuiltUtc)
            throw new PartitionException("stale capture: Space changed during capture or solve");
    }

    // ---------------------------------------------------------------- stage 2

    private sealed record BandSlices(SliceAnswer Solids, SliceAnswer Ribbons, SliceAnswer Merged);

    private static BandSlices Band(Document doc, double z0, double z1, Enclosure e, Aabb clip) {
        var s = SpaceVerbs.Slice(doc, z0, z1, e.Solids, clip);
        var r = SpaceVerbs.Slice(doc, z0, z1, e.Ribbons, clip);
        RequireStamp(s.Stamp, s.Stamp, doc.GetDocumentKey(), "solids");
        RequireStamp(r.Stamp, s.Stamp, doc.GetDocumentKey(), "ribbons");
        var merged = new SliceAnswer(
            s.Stamp,
            new Searched(
                Math.Max(s.Searched.Docs, r.Searched.Docs),
                s.Searched.Categories + r.Searched.Categories,
                s.Searched.Candidates + r.Searched.Candidates,
                s.Searched.Examined + r.Searched.Examined,
                s.Searched.Skipped + r.Searched.Skipped),
            [.. s.Elements, .. r.Elements],
            s.Pieces + r.Pieces,
            Math.Round(s.Ms + r.Ms, 3));
        return new BandSlices(s, r, merged);
    }
}
