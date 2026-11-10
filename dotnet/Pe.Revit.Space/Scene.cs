using System.IO;
using System.Numerics;
using System.Runtime.Serialization;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Revit.Space;

/// <summary>Overview acquires no native geometry. Every other choice is detailed and may retain substantial native memory.</summary>
public enum SceneContextRepresentation {
    [EnumMember(Value = "overview")] Overview,
    [EnumMember(Value = "none")] None,
    [EnumMember(Value = "oriented")] Oriented,
    [EnumMember(Value = "triangle-boxes")] TriangleBoxes,
    [EnumMember(Value = "link-boxes")] LinkBoxes,
    [EnumMember(Value = "meshes")] Meshes
}
public enum SceneRepresentation {
    [EnumMember(Value = "mesh")] Mesh,
    [EnumMember(Value = "oriented-box")] OrientedBox,
    [EnumMember(Value = "run")] Run
}
public enum SceneRunShape {
    [EnumMember(Value = "round")] Round,
    [EnumMember(Value = "rectangular")] Rectangular,
    [EnumMember(Value = "oval")] Oval
}
public enum SceneBoxFrame {
    [EnumMember(Value = "bounds")] Bounds,
    [EnumMember(Value = "symbol")] Symbol,
    [EnumMember(Value = "triangles")] Triangles,
    [EnumMember(Value = "link")] Link
}
/// <param name="ContextPaddingFt">Reach: context is what lies within this distance of each focus element's own box, never a crop around the whole focus.</param>
public sealed record SceneRequest(
    IReadOnlyList<long>? ElementIds = null,
    double ContextPaddingFt = 15,
    int MaxTriangles = 1500000,
    Aabb? Bounds = null,
    bool FocusOnly = false,
    SceneContextRepresentation ContextRepresentation = SceneContextRepresentation.Overview,
    Region? Region = null
);

/// <summary>Straight physical run in host feet, including host insulation. Curved runs use native meshes.</summary>
public sealed record SceneRun(IReadOnlyList<double> Start, IReadOnlyList<double> End, SceneRunShape Shape,
    double? WidthFt, double? HeightFt, double? DiameterFt, IReadOnlyList<double> CrossSectionXAxis) {
    /// <summary>Facets around a round profile or both semicircles of a flat oval; zero for rectangular.</summary>
    public int RadialSegments => this.Shape == SceneRunShape.Rectangular ? 0 : 32;
    /// <summary>Fraction added to the physical radius so facets contain it. Includes float32 vertex rounding; below 0.484% at 32 facets.</summary>
    public double RadialOverdrawFraction => this.RadialSegments == 0 ? 0
        // A facet's apothem is R*cos(pi/n). Float32 coordinate rounding moves a vertex by at most R*2^-24.
        // Reserve that displacement in the drawn radius, rather than tolerating a physical containment loss.
        : 1 / (Math.Cos(Math.PI / this.RadialSegments) - Math.Pow(2, -24)) - 1;
}
/// <summary>Box placed in host feet with explicit frame provenance. Link frames can overdraw elements rotated within their source. Axes are orthonormal and right-handed; HalfSize is in feet.</summary>
public sealed record SceneOrientedBox(IReadOnlyList<double> Center, IReadOnlyList<double> AxisX,
    IReadOnlyList<double> AxisY, IReadOnlyList<double> AxisZ, IReadOnlyList<double> HalfSize,
    SceneBoxFrame Frame = SceneBoxFrame.Symbol);
public sealed record SceneElement(Handle Handle, int FirstVertex, int VertexCount, Aabb Bounds, bool Focus, long? CategoryId,
    SceneRepresentation Representation, SceneRun? Run, SceneOrientedBox? OrientedBox = null);
public enum SceneSourceState {
    [EnumMember(Value = "loaded")] Loaded,
    [EnumMember(Value = "unloaded")] Unloaded,
    [EnumMember(Value = "unavailable")] Unavailable
}
/// <summary>One source instance: the host, or one placement of a link. A link document placed three times is three sources.</summary>
/// <param name="DocumentKey">Empty when the link is not loaded; Name then names its link type.</param>
/// <param name="Read">What the context read did in this source; null when context was not read or the source is not loaded.</param>
public sealed record SceneSource(string DocumentKey, long? LinkInstanceId, IReadOnlyList<double> SourceToHost,
    SceneSourceState State, string Name, SceneSourceRead? Read);
/// <param name="Counted">Ids within reach, counted without loading.</param>
/// <param name="Kept">Elements handed to representation.</param>
/// <param name="Excluded">Ids within reach per exclusion class; classes may overlap. Quick-filter classes are removed before iteration; run-insulation is classified after reading its host. <c>no-geometry</c> (native geometry has nothing to draw: curtain hosts, reveals, openings) and <c>outside-crop</c> (geometry wholly outside the picture's crop) are classified after the geometry read and stay counted in Kept.</param>
/// <param name="RejectedAfterLoad">Passed every quick filter, then refused by the managed gate: loaded for nothing.</param>
/// <param name="CutByBound">Kept elements left out by a bound or a failed native read: missing native bounds, the triangle or acquisition budget, or a geometry read that threw.</param>
/// <param name="QueryMilliseconds">The reach query; ExcludeMilliseconds the exclusion-class queries; IterateMilliseconds the element loads.</param>
public sealed record SceneSourceRead(int Counted, int Kept, IReadOnlyDictionary<string, int> Excluded, int RejectedAfterLoad,
    int CutByBound, double Milliseconds, double QueryMilliseconds, double ExcludeMilliseconds, double IterateMilliseconds);
public sealed record SceneUnavailableElement(long ElementId, string? UniqueId, string? Category, string Reason);
public sealed record SceneMetadata(string Format, Stamp Stamp, Aabb Bounds, int Triangles,
    IReadOnlyList<SceneElement> Elements, IReadOnlyList<long> RequestedElementIds, int OmittedElements,
    IReadOnlyList<SceneSource> Sources, string Phase, IReadOnlyList<SceneUnavailableElement> UnavailableElements,
    SceneWork Work, SceneCompleteness Completeness, IReadOnlyList<long> DetachedElementIds, SceneLevels Levels) {
    /// <summary>Detailed requests below 5 ft are raised; overview keeps the requested reach.</summary>
    public double RequestedContextPaddingFt { get; init; }
    public double EffectiveContextPaddingFt { get; init; }
    /// <summary>Counts by link placement. Bounding boxes alone cannot identify geometry rotated inside the source frame.</summary>
    public IReadOnlyDictionary<long, SceneLinkEnvelopeCount> LinkEnvelopes => this.Elements
        .Where(e => !e.Focus && e.Handle.LinkInstanceId.HasValue && e.OrientedBox?.Frame == SceneBoxFrame.Link)
        .GroupBy(e => e.Handle.LinkInstanceId!.Value)
        .ToDictionary(g => g.Key, g => new SceneLinkEnvelopeCount(g.Count(), null, "unmeasured-without-element-geometry"));
}
/// <param name="Elements">Published link-frame boxes in one source placement.</param>
/// <param name="LooseElements">Count exceeding 1.5 times a triangle-fitted envelope's volume; null when unmeasured, never inferred from the source bounding box.</param>
/// <param name="Looseness">Why the loose count is unknown. Measuring it requires geometry that this representation deliberately avoids.</param>
public sealed record SceneLinkEnvelopeCount(int Elements, int? LooseElements, string Looseness);
/// <param name="DeferredCandidates">Known unacquired candidates, or null when discovery stopped before the remaining count was known.</param>
public sealed record SceneCompleteness(bool Complete, int? DeferredCandidates, int AcquisitionLimitedElements, string? LimitReason);
public sealed record SceneMemory(long StartPrivateBytes, long EndPrivateBytes, long PeakPrivateBytes, long ManagedBytes);
public sealed record SceneWork(int BroadCandidates, int ExtractedElements, int ExtractedTriangles, double NativeMilliseconds,
    int PeakRetainedTriangles = 0, int NativeGeometryCalls = 0, SceneMemory? Memory = null,
    int AcquiredTriangles = 0, int ContextGeometryCalls = 0, IReadOnlyDictionary<string, double>? PhaseMilliseconds = null);
/// <summary>Bounded RPC receipt. Full membership, source transforms and unavailable identities live in PSC1.</summary>
public sealed record SceneReceipt(string Format, string Frame, string HostDocumentKey, long Epoch, DateTime BuiltUtc, bool Fresh,
    Aabb Bounds, int Triangles, int Elements, int FocusElements, int ContextElements, int RequestedElements,
    int OmittedElements, int UnavailableElements, int Sources, int UnreadSources, int DetachedElements, string Phase,
    SceneWork Work, SceneCompleteness Completeness, SceneLevelReceipt Levels,
    IReadOnlyDictionary<long, SceneLinkEnvelopeCount> LinkEnvelopes) {
    public static SceneReceipt From(SceneMetadata scene) => new(scene.Format, scene.Stamp.Frame,
        scene.Stamp.HostDocumentKey, scene.Stamp.Epoch, scene.Stamp.BuiltUtc, scene.Stamp.Fresh, scene.Bounds, scene.Triangles,
        scene.Elements.Count, scene.Elements.Count(element => element.Focus), scene.Elements.Count(element => !element.Focus),
        scene.RequestedElementIds.Count, scene.OmittedElements, scene.UnavailableElements.Count, scene.Sources.Count,
        scene.Sources.Count(source => source.State != SceneSourceState.Loaded), scene.DetachedElementIds.Count,
        scene.Phase, scene.Work, scene.Completeness, SceneLevelReceipt.From(scene.Levels), scene.LinkEnvelopes);
}
public sealed record SceneArtifact(SceneReceipt Scene, string Id, string Url, long Bytes);

/// <summary>Bounded native meshes and explicit scene primitives in host internal feet.</summary>
public static class Scene {
    public static SceneMetadata Write(Document document, SceneRequest request, Stream vertices, System.Threading.CancellationToken cancellationToken = default) {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        if (request.MaxTriangles is < 1 or > 3000000)
            throw new ArgumentException("maxTriangles must be between 1 and 3000000.");
        if (!Enum.IsDefined(typeof(SceneContextRepresentation), request.ContextRepresentation))
            throw new ArgumentException("contextRepresentation must be none, oriented, triangle-boxes, link-boxes or meshes.");
        if (!Finite(request.ContextPaddingFt) || request.ContextPaddingFt is < 0 or > 1000)
            throw new ArgumentException("contextPaddingFt must be between 0 and 1000.");
        // A region is admission, not capture bounds (spatial ledger, 2026-11-02): focus elements keep their own context reach
        // and FocusOnly follows the caller. With no focus the region is the question, so its box is the bounds and the
        // geometry cost is reported like any other read.
        var declared = request.Region?.Resolve(document);
        if (declared is { } admitted) {
            if (request.Bounds is { } given && !admitted.Contains(given))
                throw new ArgumentException("bounds must lie inside the region.");
            if (request.ElementIds is not { Count: > 0 }) request = request with { Bounds = request.Bounds ?? admitted };
        }
        if (request.Bounds is { } b && (!Finite(b.MinX, b.MinY, b.MinZ, b.MaxX, b.MaxY, b.MaxZ)
            || b.MinX >= b.MaxX || b.MinY >= b.MaxY || b.MinZ >= b.MaxZ))
            throw new ArgumentException("bounds must be finite ordered host-internal-ft bounds.");
        var ids = new HashSet<long>(request.ElementIds ?? []);
        if (request.FocusOnly && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("focusOnly requires elementIds and cannot specify bounds.");
        var overview = request.ContextRepresentation == SceneContextRepresentation.Overview;
        var requestedPadding = request.ContextPaddingFt;
        if (!overview) request = request with { ContextPaddingFt = Math.Max(5, request.ContextPaddingFt) };
        var context = request.FocusOnly ? SceneContextRepresentation.None : request.ContextRepresentation;
        if (context == SceneContextRepresentation.Meshes && ids.Count == 0 && request.Bounds is null)
            throw new ArgumentException("meshes context requires elementIds or explicit bounds.");
        var budget = new SceneBudget(request.MaxTriangles, cancellationToken);
        // Where native time goes, per phase (MAP step 3 cost split): levels, focus, reach, bounds, runs, family-frames,
        // link-boxes, meshes. Stopwatch reads only; no behaviour depends on them.
        var phases = new Dictionary<string, double>();
        T Timed<T>(string phase, Func<T> work) {
            var start = System.Diagnostics.Stopwatch.GetTimestamp();
            try { return work(); }
            finally { phases[phase] = phases.GetValueOrDefault(phase) + System.Diagnostics.Stopwatch.GetElapsedTime(start).TotalMilliseconds; }
        }
        var levels = Timed("levels", () => Levels.Read(document, cancellationToken));
        var world = SpaceWorld.SceneSources(document);
        // Admission needs no geometry: a host element's own bounding box, before anything is tessellated.
        if (declared is { } inside)
            foreach (var id in ids)
                if (document.GetElement(id.ToElementId()) is { } candidate && world.Partitions[0].SceneBounds(candidate) is { } box && !inside.Contains(box))
                    throw new ArgumentException($"Element {id} lies outside the region; a scene's focus elements must lie inside it.");
        // Plan a conservative bounding-box reach before any focus capture (including mesh fallbacks).
        var plannedMembers = new List<(long Id, Aabb Box, XYZ[] Corners)>();
        foreach (var id in ids) {
            if (document.GetElement(id.ToElementId()) is not { } element || world.Partitions[0].SceneBounds(element) is not { } box) continue;
            var run = ReadRun(element, Transform.Identity);
            if (run is not null) box = Oriented.Bounds(run);
            plannedMembers.Add((id, box, run is null ? Corners(box.Expand(request.ContextPaddingFt)) : Corners(run, request.ContextPaddingFt)));
        }
        var plannedBound = request.Bounds ?? plannedMembers.Select(m => m.Box.Expand(request.ContextPaddingFt)).Aggregate(Aabb.Empty, Union);
        var plannedReach = Reach(plannedMembers, request.ContextPaddingFt, out var plannedDetached);
        if (request.Bounds is { } explicitPlan) plannedReach = [Corners(explicitPlan)];
        var plans = world.Partitions.Select(p => context == SceneContextRepresentation.None
            ? ReachPlan.Empty(p) : p.Plan(plannedReach, Corners(plannedBound))).ToList();
        var hostPlan = plans[0];
        var hostIds = hostPlan.Keep.Concat(ids.Select(id => id.ToElementId()).Where(id => document.GetElement(id) is not null)).Distinct().ToArray();
        plans[0] = hostPlan with { Keep = hostIds, Counted = hostPlan.Counted + hostIds.Length - hostPlan.Keep.Count };
        world.Acquisition = new GeometryLedger.Read(plans, overview);
        static SceneOrientedBox OverviewBox(Aabb b) => new(
            [(b.MinX + b.MaxX) / 2, (b.MinY + b.MaxY) / 2, (b.MinZ + b.MaxZ) / 2],
            [1, 0, 0], [0, 1, 0], [0, 0, 1],
            [(b.MaxX - b.MinX) / 2, (b.MaxY - b.MinY) / 2, (b.MaxZ - b.MinZ) / 2], SceneBoxFrame.Bounds);
        var frames = new List<(Element Element, Aabb Bounds, SceneOrientedBox Box)>();
        foreach (var partition in world.Partitions) partition.BeginScene(world.CurrentEpoch);
        var oriented = new Oriented(budget);
        var focus = new List<(Partition Source, PrimRow Row, Tri[] Triangles)>();
        var runs = new List<(Partition Source, Element Element, Aabb Bounds, SceneRun Run)>();
        var focusCount = 0;
        var unavailable = new List<SceneUnavailableElement>();
        var focusBounds = Aabb.Empty;
        var extracted = 0;
        var extractedTriangles = 0;
        var broad = 0;
        var deferred = 0;
        var limited = 0;
        var omitted = 0;
        string? limit = null;
        var reads = new Dictionary<Partition, (SceneReach Reach, int Kept, int Cut)>();
        void Cut(Partition partition) { if (reads.TryGetValue(partition, out var r)) reads[partition] = r with { Cut = r.Cut + 1 }; }
        // Post-read classes: elements read whole that are honestly absent from the picture, never a completeness failure.
        var classified = new Dictionary<Partition, Dictionary<string, int>>();
        void Classify(Partition partition, string kind) {
            if (!classified.TryGetValue(partition, out var classes)) classified[partition] = classes = new Dictionary<string, int>();
            classes[kind] = classes.TryGetValue(kind, out var n) ? n + 1 : 1;
        }
        IReadOnlyList<long> detached = request.Bounds is null ? plannedDetached : [];
        var elements = new List<SceneElement>();
        var triangles = 0;
        var writtenBounds = Aabb.Empty;
        var crop = request.Bounds;
        using var writer = new BinaryWriter(vertices, System.Text.Encoding.UTF8, true);
        LinkedGeometryStore.Geometry Capture(Partition partition, Element element, Aabb? region, Ingest.Miss? miss = null) {
            var rows = new List<PrimRow>();
            var mesh = new List<Tri>();
            Ingest.Element(element, partition.Source, 0, mesh, partition.Transform, rows,
                includeCurves: false, region: region, budget: budget, symbols: oriented.Meshes, miss: miss);
            var captured = new LinkedGeometryStore.Geometry(rows.ToArray(), mesh.ToArray());
            extracted++;
            extractedTriangles += captured.Triangles.Length;
            partition.RecordScene(captured);
            budget.Retained(focusCount + captured.Triangles.Length + oriented.Meshes.TriangleCount);
            return captured;
        }
        try {
            foreach (var id in ids) {
                budget.Check();
                var element = document.GetElement(id.ToElementId());
                if (element is null || !Ingest.Allowed(element)) {
                    unavailable.Add(new SceneUnavailableElement(id, element?.UniqueId, element?.Category?.Name,
                        element is null ? "Element is absent from this document." : "Element has no supported visible scene representation."));
                    continue;
                }
                var bounds = world.Partitions[0].SceneBounds(element);
                var run = bounds is not null ? ReadRun(element, world.Partitions[0].Transform) : null;
                if (run is not null && bounds is { } runBounds) {
                    var representedBounds = Oriented.Bounds(run);
                    runs.Add((world.Partitions[0], element, representedBounds, run));
                    focusBounds = Union(focusBounds, representedBounds);
                    continue;
                }
                if (bounds is { } frameBounds && (overview || request.ContextRepresentation != SceneContextRepresentation.Meshes)) {
                    var frame = overview ? OverviewBox(frameBounds) : oriented.Family(element, world.Partitions[0].Transform);
                    if (frame is not null) {
                        frames.Add((element, frameBounds, frame));
                        focusBounds = Union(focusBounds, frameBounds);
                        if (overview) unavailable.Add(new SceneUnavailableElement(id, element.UniqueId, element.Category?.Name,
                            "Overview uses bounding box; native family geometry is not acquired."));
                        continue;
                    }
                }
                if (overview) {
                    unavailable.Add(new SceneUnavailableElement(id, element.UniqueId, element.Category?.Name, "Overview: no bounding box available."));
                    continue;
                }
                LinkedGeometryStore.Geometry captured;
                try { captured = Capture(world.Partitions[0], element, null); }
                catch (SceneLimitException ex) {
                    throw new InvalidOperationException($"Exact focus acquisition stopped ({ex.Reason}); no partial focus artifact was published. Narrow the selected scope.", ex);
                }
                if (captured.Rows.Length == 0) {
                    unavailable.Add(new SceneUnavailableElement(id, element.UniqueId, element.Category?.Name, "No visible mesh was produced at Medium or Fine detail."));
                    continue;
                }
                if (focusCount + captured.Triangles.Length > request.MaxTriangles)
                    throw new ArgumentException("Selected mesh exceeds maxTriangles; narrow elementIds or raise the budget.");
                focusCount += captured.Triangles.Length;
                foreach (var row in captured.Rows) {
                    focus.Add((world.Partitions[0], row, captured.Triangles));
                    focusBounds = Union(focusBounds, row.Box);
                }
            }
            if (ids.Count > 0 && focus.Count + runs.Count + frames.Count == 0 && crop is null)
                throw new ArgumentException("None of the requested elementIds produced a visible host representation.");
            List<XYZ[]> reach = [];
            // Every point within reach of a focus element lies inside the focus bounds grown by reach (main's crop),
            // so each reach outline is clamped to it in each source's frame: a diagonal run's oriented box poked past it.
            XYZ[] bound = [];
            if (context != SceneContextRepresentation.None) {
                bound = Corners(request.Bounds ?? focusBounds.Expand(request.ContextPaddingFt));
                reach = request.Bounds is { } explicitBounds ? [Corners(explicitBounds)]
                    : plannedReach;
                // The crop is the host extent of the reach boxes, never the focus bounds grown: a diagonal run's
                // reach box reaches past them, and what reach admits must not be clipped away unseen.
                if (crop is null && reach.Count > 0) crop = reach.SelectMany(corners => corners)
                    .Aggregate(Aabb.Empty, (box, p) => box.Include(new Vector3((float)p.X, (float)p.Y, (float)p.Z)));
            }
            phases["focus"] = clock.Elapsed.TotalMilliseconds - phases.GetValueOrDefault("levels");
            var focusGeometryCalls = budget.GeometryCalls;
            var index = new SceneFocusIndex(focus.Select(row => row.Row.Box).Concat(runs.Select(row => row.Bounds)).Concat(frames.Select(row => row.Bounds)).ToArray());
            var runIndex = new SceneFocusIndex(runs.Select(row => row.Bounds).ToArray());
            var proximity = context == SceneContextRepresentation.Meshes && focus.Count > 0
                ? Bvh.Build(focus.SelectMany(row => row.Triangles).ToArray()) : null;
            bool Write(Partition partition, PrimRow row, Tri[] source, bool isFocus) {
                if (crop is { } region && !row.Box.Overlaps(region)) return false;
                var contains = row.Kind == PrimKind.Solid && index.ContainedBy(row.Box);
                var kept = new List<Tri>();
                var bounds = Aabb.Empty;
                var visited = 0;
                var stopped = false;
                foreach (var t in source) {
                    if ((visited++ & 255) == 0) budget.Check();
                    // Run bounds conservatively retain context around focus that owns no triangles.
                    if (!isFocus && !contains && proximity is not null && !proximity.Within(t, request.ContextPaddingFt)
                        && !(runs.Count > 0 && runIndex.Overlaps(Box(t), request.ContextPaddingFt))) continue;
                    if (proximity is null && crop is { } box) {
                        foreach (var clipped in Clip(t, box)) if (!Take(clipped)) break;
                    } else if (!Take(t)) break;
                    if (stopped) break;
                }
                if (kept.Count == 0) return false;
                var category = partition.Doc.GetElement(row.ElementId.ToElementId())?.Category?.Id.Value();
                elements.Add(new SceneElement(partition.HandleFor(row), triangles * 3, kept.Count * 3, bounds, isFocus, category,
                    SceneRepresentation.Mesh, null));
                foreach (var t in kept) {
                    writer.Write(t.A.X); writer.Write(t.A.Y); writer.Write(t.A.Z);
                    writer.Write(t.B.X); writer.Write(t.B.Y); writer.Write(t.B.Z);
                    writer.Write(t.C.X); writer.Write(t.C.Y); writer.Write(t.C.Z);
                }
                writtenBounds = Union(writtenBounds, bounds);
                triangles += kept.Count;
                return true;
                bool Take(Tri triangle) {
                    if (triangles + kept.Count >= request.MaxTriangles) {
                        if (isFocus) throw new ArgumentException("Selected mesh exceeds maxTriangles; narrow elementIds or raise the budget.");
                        omitted++; limit ??= "output-budget"; Cut(partition);
                        stopped = true;
                        return false;
                    }
                    kept.Add(triangle); bounds = Union(bounds, Box(triangle));
                    budget.Retained(focusCount + source.Length + kept.Count + oriented.Meshes.TriangleCount);
                    return true;
                }
            }
            void Primitive(Partition partition, Element element, Aabb bounds, SceneRun? run, bool isFocus, SceneOrientedBox? knownBox = null) {
                if (crop is { } region && !bounds.Overlaps(region)) return;
                if (!isFocus && limit == "acquisition-budget") { deferred++; Cut(partition); return; }
                try {
                    var box = knownBox ?? (run is null ? overview ? OverviewBox(bounds) : Timed("family-frames", () => oriented.Family(element, partition.Transform)) : null);
                    if (overview && run is null && knownBox is null) unavailable.Add(new SceneUnavailableElement(element.Id.Value(), element.UniqueId, element.Category?.Name, "Overview uses bounding box; native geometry is not acquired."));
                    if (!isFocus && run is null && box is null && context == SceneContextRepresentation.LinkBoxes
                        && partition.Kind != SourceKind.Host)
                        box = Timed("link-boxes", () => oriented.Link(element, partition.Transform));
                    if (run is null && box is null) {
                        if (!isFocus && triangles >= request.MaxTriangles) {
                            deferred++; limit ??= "output-budget"; Cut(partition); return;
                        }
                        var envelope = !isFocus && context == SceneContextRepresentation.TriangleBoxes && element is DirectShape;
                        // An element's envelope needs its whole geometry, before the scene crop clips any triangles.
                        var miss = new Ingest.Miss();
                        var captured = Timed("meshes", () => Capture(partition, element, envelope ? null : crop, miss));
                        box = envelope ? Timed("meshes", () => TriangleBox.Fit(captured.Triangles, budget.Check)) : null;
                        if (box is null) {
                            var wrote = Timed("meshes", () => captured.Rows.Aggregate(false, (any, meshRow) => Write(partition, meshRow, captured.Triangles, isFocus) | any));
                            // Only a native read that threw is missing geometry. Nothing to draw, or nothing inside the
                            // crop, is disclosed per source and leaves the picture complete (Cleremont 204, MAP step 3).
                            if (!wrote && miss.Failed) {
                                omitted++; limit ??= "missing-geometry"; Cut(partition);
                            } else if (!wrote && !isFocus) Classify(partition, captured.Rows.Length == 0 && !miss.Outside ? "no-geometry" : "outside-crop");
                            return;
                        }
                    }
                    bounds = run is not null ? Oriented.Bounds(run) : Oriented.Bounds(box!);
                    var row = new PrimRow(partition.Source, element.Id.Value(), element.UniqueId, element.Category?.Name ?? "<none>",
                        PrimKind.Element, bounds, 0, HeightRole: HeightRoles.Of(element.Category?.Id.Value(), element is ImportInstance));
                    elements.Add(new SceneElement(partition.HandleFor(row), triangles * 3, 0, bounds, isFocus,
                        element.Category?.Id.Value(), run is null ? SceneRepresentation.OrientedBox : SceneRepresentation.Run, run, box));
                    partition.RecordScene(new LinkedGeometryStore.Geometry([row], []));
                    writtenBounds = Union(writtenBounds, bounds);
                } catch (SceneLimitException ex) {
                    if (isFocus) throw;
                    limited++; omitted++; limit = ex.Reason; Cut(partition);
                }
            }
            foreach (var row in focus) Write(row.Source, row.Row, row.Triangles, true);
            foreach (var row in frames) Primitive(world.Partitions[0], row.Element, row.Bounds, null, true, row.Box);
            foreach (var row in runs) Primitive(row.Source, row.Element, row.Bounds, row.Run, true);
            if (context != SceneContextRepresentation.None) {
                var candidates = new List<(Partition Source, long Id, Aabb Bounds, double Distance)>();
                foreach (var plan in plans) {
                    var partition = plan.Source;
                    budget.Check();
                    var read = Timed("reach", () => partition.Load(plan,
                        context is SceneContextRepresentation.Oriented or SceneContextRepresentation.TriangleBoxes or SceneContextRepresentation.LinkBoxes));
                    reads[partition] = (read, 0, 0);
                    broad += read.Counted;
                    foreach (var element in read.Kept) {
                        budget.Check();
                        if (partition.Kind == SourceKind.Host && ids.Contains(element.Id.Value())) continue;
                        var box = Timed("bounds", () => partition.SceneBounds(element));
                        if (box is null) { omitted++; limit ??= "missing-bounds"; Cut(partition); continue; }
                        reads[partition] = reads[partition] with { Kept = reads[partition].Kept + 1 };
                        // ETW showed Revit retains native tessellation allocations; bound what we ask it to tessellate.
                        // Runs and proven family frames avoid tessellation. Unknown frames retain native meshes.
                        if (overview || context is SceneContextRepresentation.Oriented or SceneContextRepresentation.TriangleBoxes or SceneContextRepresentation.LinkBoxes) {
                            Primitive(partition, element, box.Value, Timed("runs", () => ReadRun(element, partition.Transform)), false);
                            continue;
                        }
                        candidates.Add((partition, element.Id.Value(), box.Value, index.DistanceSquared(box.Value)));
                    }
                }
                candidates = candidates.OrderBy(row => row.Distance).ToList();
                for (var i = 0; i < candidates.Count; i++) {
                    if (triangles >= request.MaxTriangles) {
                        deferred += candidates.Count - i; limit ??= "output-budget";
                        foreach (var rest in candidates.Skip(i)) Cut(rest.Source);
                        break;
                    }
                    var candidate = candidates[i];
                    var element = candidate.Source.Doc.GetElement(candidate.Id.ToElementId());
                    if (element is null) { omitted++; limit ??= "missing-element"; Cut(candidate.Source); continue; }
                    try {
                        budget.Check();
                        var captured = Capture(candidate.Source, element, crop);
                        foreach (var row in captured.Rows) Write(candidate.Source, row, captured.Triangles, false);
                    } catch (SceneLimitException ex) {
                        limited++; limit = ex.Reason; Cut(candidate.Source);
                        if (ex.Reason != "element-acquisition-limit") {
                            deferred += candidates.Count - i - 1;
                            foreach (var rest in candidates.Skip(i + 1)) Cut(rest.Source);
                            break;
                        }
                    }
                }
            }
            if (elements.Count == 0) {
                if (limit is not null) throw new InvalidOperationException($"Scene acquisition stopped ({limit}) before a representation could be published.");
                throw new ArgumentException("No representation fits this scope and triangle budget.");
            }
            return new SceneMetadata("space-scene-v5", world.StampFor(world.Partitions, Filter.Default), crop ?? writtenBounds,
                triangles, elements, ids.ToList(), omitted, world.Partitions.Select(p => new SceneSource(p.DocumentKey,
                    p.LinkInstanceId, Matrix(p.Transform), SceneSourceState.Loaded, p.Doc.Title,
                    reads.TryGetValue(p, out var r) ? new SceneSourceRead(r.Reach.Counted, r.Kept, Merge(r.Reach.Excluded, classified.GetValueOrDefault(p)),
                        r.Reach.RejectedAfterLoad, r.Cut, r.Reach.Milliseconds, r.Reach.QueryMilliseconds, r.Reach.ExcludeMilliseconds,
                        r.Reach.IterateMilliseconds) : null))
                    .Concat(world.Unread.Select(u => new SceneSource("", u.LinkInstanceId, Matrix(u.Transform), u.State, u.Name, null)))
                    .ToList(), context == SceneContextRepresentation.None ? "focus" : "context", unavailable,
                new SceneWork(broad, extracted, extractedTriangles, clock.Elapsed.TotalMilliseconds,
                    budget.PeakRetainedTriangles, budget.NativeCalls, budget.Diagnostics(), budget.NativeTriangles,
                    budget.GeometryCalls - focusGeometryCalls, phases),
                new SceneCompleteness(limit is null, deferred, limited, limit), detached, levels) { RequestedContextPaddingFt = requestedPadding, EffectiveContextPaddingFt = request.ContextPaddingFt };
        } finally {
            oriented.Meshes.Entries.Clear();
        }
    }

    private static IReadOnlyDictionary<string, int> Merge(IReadOnlyDictionary<string, int> excluded, Dictionary<string, int>? classified) {
        if (classified is null) return excluded;
        var merged = excluded.ToDictionary(pair => pair.Key, pair => pair.Value);
        foreach (var (kind, count) in classified) merged[kind] = merged.TryGetValue(kind, out var n) ? n + count : count;
        return merged;
    }

    private static IReadOnlyList<double> Matrix(Transform t) => [
        t.BasisX.X, t.BasisX.Y, t.BasisX.Z, 0, t.BasisY.X, t.BasisY.Y, t.BasisY.Z, 0,
        t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z, 0, t.Origin.X, t.Origin.Y, t.Origin.Z, 1
    ];

    /// <summary>
    ///     One reach box per focus element, in host feet, as 8 corners: a run's own oriented box (location line and
    ///     size), else its native bounding box, grown by <paramref name="reachFt" />. Members whose reach meets no
    ///     reach of the largest group are <paramref name="detached" />: still read, and disclosed (Cleremont SA 2
    ///     carries air terminals 1,500 ft from the rest of its system).
    /// </summary>
    private static List<XYZ[]> Reach(List<(long Id, Aabb Box, XYZ[] Corners)> members,
        double reachFt, out IReadOnlyList<long> detached) {
        // ponytail: O(n²) single linkage over the grown host boxes. n is one system's members (501 on Chadds SA 7);
        // sort-and-sweep when a request names thousands.
        var root = Enumerable.Range(0, members.Count).ToArray();
        int Find(int i) => root[i] == i ? i : root[i] = Find(root[i]);
        for (var i = 0; i < members.Count; i++)
        for (var j = i + 1; j < members.Count; j++)
            if (members[i].Box.Expand(reachFt).Overlaps(members[j].Box.Expand(reachFt))) root[Find(i)] = Find(j);
        var main = Enumerable.Range(0, members.Count).GroupBy(Find).OrderByDescending(g => g.Count()).FirstOrDefault()?.Key;
        detached = Enumerable.Range(0, members.Count).Where(i => Find(i) != main).Select(i => members[i].Id).Distinct().ToList();
        return members.Select(member => member.Corners).ToList();
    }

    private static XYZ[] Corners(Aabb box) => [
        new(box.MinX, box.MinY, box.MinZ), new(box.MaxX, box.MinY, box.MinZ), new(box.MinX, box.MaxY, box.MinZ), new(box.MaxX, box.MaxY, box.MinZ),
        new(box.MinX, box.MinY, box.MaxZ), new(box.MaxX, box.MinY, box.MaxZ), new(box.MinX, box.MaxY, box.MaxZ), new(box.MaxX, box.MaxY, box.MaxZ)
    ];

    // A run's reach follows its location line: on a diagonal duct the host-axis box is up to twice the volume.
    private static XYZ[] Corners(SceneRun run, double reachFt) {
        var start = new XYZ(run.Start[0], run.Start[1], run.Start[2]);
        var end = new XYZ(run.End[0], run.End[1], run.End[2]);
        var along = (end - start).Normalize();
        var x = new XYZ(run.CrossSectionXAxis[0], run.CrossSectionXAxis[1], run.CrossSectionXAxis[2]);
        var y = along.CrossProduct(x);
        var halfX = (run.DiameterFt ?? run.WidthFt ?? 0) / 2 + reachFt;
        var halfY = (run.DiameterFt ?? run.HeightFt ?? 0) / 2 + reachFt;
        var a = start - along * reachFt;
        var b = end + along * reachFt;
        return [.. from p in new[] { a, b } from sx in new[] { -1, 1 } from sy in new[] { -1, 1 } select p + x * (sx * halfX) + y * (sy * halfY)];
    }

    /// <summary>
    ///     A duct or pipe's insulation thickness, read from the host. Sized runs absorb their insulation;
    ///     fitting/accessory insulation retains its own native geometry. The
    ///     host's value equals the insulation's own Thickness on 4,294 Chadds duct and 3,267/3,267 pipe insulations
    ///     with a readable parameter (probe-o, clone copy, 2026-10-28). Four duct hosts have no parameter. Null when none.
    /// </summary>
    public static double? InsulationThicknessFt(Element host) =>
        host.get_Parameter(BuiltInParameter.RBS_REFERENCE_INSULATION_THICKNESS) is { HasValue: true } p
        && p.AsDouble() is var t and > 0 ? t : null;

    internal static SceneRun? ReadRun(Element element, Transform transform) => Oriented.Run(element, transform);

    private static Aabb Box(Tri t) => new(
        Math.Min(t.A.X, Math.Min(t.B.X, t.C.X)), Math.Min(t.A.Y, Math.Min(t.B.Y, t.C.Y)), Math.Min(t.A.Z, Math.Min(t.B.Z, t.C.Z)),
        Math.Max(t.A.X, Math.Max(t.B.X, t.C.X)), Math.Max(t.A.Y, Math.Max(t.B.Y, t.C.Y)), Math.Max(t.A.Z, Math.Max(t.B.Z, t.C.Z)));

    // Clip once at capture. Every consumer sees the same geometry and picking needs no scope exception.
    private static IEnumerable<Tri> Clip(Tri triangle, Aabb bounds) {
        var box = Box(triangle);
        if (!box.Overlaps(bounds)) yield break;
        if (box.MinX >= bounds.MinX && box.MaxX <= bounds.MaxX && box.MinY >= bounds.MinY
            && box.MaxY <= bounds.MaxY && box.MinZ >= bounds.MinZ && box.MaxZ <= bounds.MaxZ) {
            yield return triangle;
            yield break;
        }
        var polygon = new List<Vector3> { triangle.A, triangle.B, triangle.C };
        for (var axis = 0; axis < 3 && polygon.Count > 0; axis++) {
            var min = axis == 0 ? bounds.MinX : axis == 1 ? bounds.MinY : bounds.MinZ;
            var max = axis == 0 ? bounds.MaxX : axis == 1 ? bounds.MaxY : bounds.MaxZ;
            polygon = Half(polygon, axis, min, true);
            polygon = Half(polygon, axis, max, false);
        }
        for (var i = 1; i + 1 < polygon.Count; i++) {
            var t = new Tri { A = polygon[0], B = polygon[i], C = polygon[i + 1], Prim = triangle.Prim };
            if (!t.IsDegenerate) yield return t;
        }
    }

    private static List<Vector3> Half(List<Vector3> input, int axis, double value, bool keepAbove) {
        var output = new List<Vector3>();
        if (input.Count == 0) return output;
        float Component(Vector3 p) => axis == 0 ? p.X : axis == 1 ? p.Y : p.Z;
        var previous = input[input.Count - 1];
        var previousDistance = Component(previous) - value;
        foreach (var current in input) {
            var distance = Component(current) - value;
            if ((distance >= 0) != (previousDistance >= 0))
                output.Add(Vector3.Lerp(previous, current, (float)(previousDistance / (previousDistance - distance))));
            if (keepAbove ? distance >= 0 : distance <= 0) output.Add(current);
            previous = current;
            previousDistance = distance;
        }
        return output;
    }

    private static bool Finite(params double[] values) => values.All(v => !double.IsNaN(v) && !double.IsInfinity(v));
    private static Aabb Union(Aabb a, Aabb b) => new(Math.Min(a.MinX, b.MinX), Math.Min(a.MinY, b.MinY),
        Math.Min(a.MinZ, b.MinZ), Math.Max(a.MaxX, b.MaxX), Math.Max(a.MaxY, b.MaxY), Math.Max(a.MaxZ, b.MaxZ));
}
