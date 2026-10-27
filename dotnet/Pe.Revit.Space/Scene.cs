using System.IO;
using System.Numerics;

namespace Pe.Revit.Space;

public sealed record SceneRequest(
    IReadOnlyList<long>? ElementIds = null,
    double ContextPaddingFt = 15,
    int MaxTriangles = 1500000,
    Aabb? Bounds = null,
    bool FocusOnly = false,
    bool Proximity = false
);

public sealed record SceneElement(Handle Handle, int FirstVertex, int VertexCount, Aabb Bounds, bool Focus, long? CategoryId);
public sealed record SceneSource(string DocumentKey, long? LinkInstanceId, IReadOnlyList<double> SourceToHost);
public sealed record SceneUnavailableElement(long ElementId, string? UniqueId, string? Category, string Reason);
public sealed record SceneMetadata(string Format, Stamp Stamp, Aabb Bounds, int Triangles,
    IReadOnlyList<SceneElement> Elements, IReadOnlyList<long> RequestedElementIds, int OmittedElements,
    IReadOnlyList<SceneSource> Sources, string Phase, IReadOnlyList<SceneUnavailableElement> UnavailableElements,
    SceneWork Work, SceneCompleteness Completeness);
/// <param name="DeferredCandidates">Known unacquired candidates, or null when discovery stopped before the remaining count was known.</param>
public sealed record SceneCompleteness(bool Complete, int? DeferredCandidates, int AcquisitionLimitedElements, string? LimitReason);
public sealed record SceneMemory(long StartPrivateBytes, long EndPrivateBytes, long PeakPrivateBytes, long BaselinePrivateBytes,
    long NativeGrowthAllowanceBytes, long PhysicalHeadroomBytes, long ManagedBytes);
public sealed record SceneWork(int BroadCandidates, int ExtractedElements, int ExtractedTriangles, double NativeMilliseconds,
    int PeakRetainedTriangles = 0, int NativeGeometryCalls = 0, SceneMemory? Memory = null);
public sealed record SceneArtifact(SceneMetadata Scene, string Id, string Url, long Bytes);

/// <summary>Bounded real triangles. Coordinates remain host internal feet.</summary>
public static class Scene {
    public static SceneMetadata Write(Document document, SceneRequest request, Stream vertices, System.Threading.CancellationToken cancellationToken = default) {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        if (request.MaxTriangles is < 1 or > 3000000)
            throw new ArgumentException("maxTriangles must be between 1 and 3000000.");
        if (double.IsNaN(request.ContextPaddingFt) || double.IsInfinity(request.ContextPaddingFt)
            || request.ContextPaddingFt is < 0 or > 1000)
            throw new ArgumentException("contextPaddingFt must be between 0 and 1000.");
        if (request.Bounds is { } b && (!Finite(b.MinX, b.MinY, b.MinZ, b.MaxX, b.MaxY, b.MaxZ)
            || b.MinX >= b.MaxX || b.MinY >= b.MaxY || b.MinZ >= b.MaxZ))
            throw new ArgumentException("bounds must be finite ordered host-internal-ft bounds.");

        var ids = new HashSet<long>(request.ElementIds ?? []);
        if (request.Proximity && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("proximity requires elementIds and cannot specify bounds.");
        if (request.FocusOnly && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("focusOnly requires elementIds and cannot specify bounds.");
        using var budget = new SceneBudget(request.MaxTriangles, cancellationToken);
        var world = SpaceWorld.SceneSources(document);
        foreach (var partition in world.Partitions) partition.BeginScene(world.CurrentEpoch);
        var leases = new Dictionary<Partition, IDisposable?>();
        var focus = new List<(Partition Source, PrimRow Row, Tri[] Triangles)>();
        var focusCount = 0;
        var unavailable = new List<SceneUnavailableElement>();
        var focusBounds = Aabb.Empty;
        var extracted = 0;
        var extractedTriangles = 0;
        var broad = 0;
        int? deferred = 0;
        var limited = 0;
        var omitted = 0;
        string? limit = null;
        var elements = new List<SceneElement>();
        var triangles = 0;
        var writtenBounds = Aabb.Empty;
        var crop = request.Bounds;
        using var writer = new BinaryWriter(vertices, System.Text.Encoding.UTF8, true);
        LinkedGeometryStore.Geometry Capture(Partition partition, Element element, Aabb? region) {
            if (!leases.ContainsKey(partition)) leases[partition] = partition.OpenScene();
            var captured = partition.CaptureScene(element, region, budget);
            extracted++;
            extractedTriangles += captured.Triangles.Length;
            partition.RecordScene(captured);
            budget.Retained(focusCount + captured.Triangles.Length);
            return captured;
        }
        try {
            // Exact focus is acquired once and bounds the only geometry retained across elements.
            foreach (var id in ids) {
                cancellationToken.ThrowIfCancellationRequested();
                var element = document.GetElement(id.ToElementId());
                if (element is null || !Ingest.Allowed(element)) {
                    unavailable.Add(new SceneUnavailableElement(id, element?.UniqueId, element?.Category?.Name,
                        element is null ? "Element is absent from this document." : "No visible mesh was produced at Medium or Fine detail."));
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
            if (ids.Count > 0 && focus.Count == 0 && crop is null)
                throw new ArgumentException("None of the requested elementIds produced a visible host mesh.");
            if (!request.FocusOnly && crop is null && focus.Count > 0) crop = focusBounds.Expand(request.ContextPaddingFt);
            var index = new SceneFocusIndex(focus.Select(row => row.Row.Box).ToArray());
            try { if (!request.FocusOnly) budget.Headroom(); }
            catch (SceneLimitException ex) { limit = ex.Reason; deferred = null; }
            var proximity = request.Proximity && !request.FocusOnly && limit is null ? Bvh.Build(focus.SelectMany(row => row.Triangles).ToArray()) : null;

            void Write(Partition partition, PrimRow row, Tri[] source, bool isFocus) {
                if (crop is { } region && !row.Box.Overlaps(region)) return;
                var contains = proximity is not null && row.Kind == PrimKind.Solid && index.ContainedBy(row.Box);
                var kept = new List<Tri>();
                var bounds = Aabb.Empty;
                var visited = 0;
                foreach (var t in source) {
                    if ((visited++ & 255) == 0) {
                        cancellationToken.ThrowIfCancellationRequested();
                        if (!isFocus) budget.Context();
                    }
                    if (!isFocus && !contains && proximity is not null && !proximity.Within(t, request.ContextPaddingFt)) continue;
                    if (proximity is null && crop is { } box) {
                        foreach (var clipped in Clip(t, box)) if (!Take(clipped)) return;
                    } else if (!Take(t)) return;
                }
                if (kept.Count == 0) return;
                var category = partition.Doc.GetElement(row.ElementId.ToElementId())?.Category?.Id.Value();
                elements.Add(new SceneElement(partition.HandleFor(row), triangles * 3, kept.Count * 3, bounds, isFocus, category));
                foreach (var t in kept) {
                    writer.Write(t.A.X); writer.Write(t.A.Y); writer.Write(t.A.Z);
                    writer.Write(t.B.X); writer.Write(t.B.Y); writer.Write(t.B.Z);
                    writer.Write(t.C.X); writer.Write(t.C.Y); writer.Write(t.C.Z);
                }
                writtenBounds = Union(writtenBounds, bounds);
                triangles += kept.Count;
                bool Take(Tri triangle) {
                    if (triangles + kept.Count >= request.MaxTriangles) {
                        if (isFocus) throw new ArgumentException("Selected mesh exceeds maxTriangles; narrow elementIds or raise the budget.");
                        omitted++; limit ??= "output-budget";
                        return false;
                    }
                    kept.Add(triangle); bounds = Union(bounds, Box(triangle));
                    budget.Retained(focusCount + source.Length + kept.Count);
                    return true;
                }
            }
            foreach (var row in focus) Write(row.Source, row.Row, row.Triangles, true);
            if (!request.FocusOnly && limit is null) {
                var candidates = new List<(Partition Source, long Id, double Distance)>();
                var discoveryStopped = false;
                foreach (var partition in world.Partitions) {
                    foreach (var element in partition.SceneElements(crop)) {
                        if ((broad & 127) == 0) {
                            try { budget.Context(); budget.AfterNative(); }
                            catch (SceneLimitException ex) { limit = ex.Reason; deferred = null; discoveryStopped = true; break; }
                        }
                        broad++;
                        if (partition.Kind == SourceKind.Host && ids.Contains(element.Id.Value())) continue;
                        if (!Ingest.Allowed(element)) continue;
                        if (candidates.Count >= request.MaxTriangles) { deferred = null; limit ??= "acquisition-budget"; discoveryStopped = true; break; }
                        var bounds = partition.SceneBounds(element);
                        if (request.Proximity && bounds is { } local && !index.Overlaps(local, request.ContextPaddingFt)) continue;
                        candidates.Add((partition, element.Id.Value(), bounds is { } candidateBounds ? index.DistanceSquared(candidateBounds) : double.PositiveInfinity));
                    }
                    if (discoveryStopped) break;
                }
                // Native element bounds rank nearby focus, not the enormous union enclosing a whole building.
                candidates = candidates.OrderBy(row => row.Distance).ToList();
                for (var i = 0; i < candidates.Count; i++) {
                    if (triangles >= request.MaxTriangles) { if (deferred is not null) deferred += candidates.Count - i; limit ??= "output-budget"; break; }
                    var candidate = candidates[i];
                    var element = candidate.Source.Doc.GetElement(candidate.Id.ToElementId());
                    if (element is null) continue;
                    try {
                        budget.Context();
                        var captured = Capture(candidate.Source, element, crop);
                        foreach (var row in captured.Rows) Write(candidate.Source, row, captured.Triangles, false);
                    } catch (SceneLimitException ex) {
                        limited++; limit = ex.Reason;
                        if (ex.Reason != "element-acquisition-limit") { if (deferred is not null) deferred += candidates.Count - i - 1; break; }
                    }
                }
            }
            if (triangles == 0) {
                if (limit is not null) throw new InvalidOperationException($"Scene acquisition stopped ({limit}) before a mesh could be published.");
                throw new ArgumentException("No mesh fits this scope and triangle budget.");
            }
            return new SceneMetadata("space-scene-v2", world.StampFor(world.Partitions, Filter.Default), crop ?? writtenBounds,
                triangles, elements, ids.ToList(), omitted, world.Partitions.Select(p => {
                    var t = p.Transform;
                    return new SceneSource(p.DocumentKey, p.LinkInstanceId, new[] {
                        t.BasisX.X, t.BasisX.Y, t.BasisX.Z, 0, t.BasisY.X, t.BasisY.Y, t.BasisY.Z, 0,
                        t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z, 0, t.Origin.X, t.Origin.Y, t.Origin.Z, 1
                    });
                }).ToList(), request.FocusOnly ? "focus" : "context", unavailable,
                new SceneWork(broad, extracted, extractedTriangles, clock.Elapsed.TotalMilliseconds,
                    budget.PeakRetainedTriangles, budget.NativeCalls, budget.Diagnostics()),
                new SceneCompleteness(limit is null, deferred, limited, limit));
        } finally {
            foreach (var lease in leases.Values) lease?.Dispose();
            LinkedGeometryStore.Prune();
        }
    }

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
