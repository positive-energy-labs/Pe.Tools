using System.IO;
using System.Numerics;
using System.Runtime.Serialization;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Revit.Space;

public enum SceneContextRepresentation {
    [EnumMember(Value = "none")] None,
    [EnumMember(Value = "boxes")] Boxes,
    [EnumMember(Value = "meshes")] Meshes
}
public enum SceneRepresentation {
    [EnumMember(Value = "mesh")] Mesh,
    [EnumMember(Value = "box")] Box,
    [EnumMember(Value = "run")] Run
}
public enum SceneRunShape {
    [EnumMember(Value = "round")] Round,
    [EnumMember(Value = "rectangular")] Rectangular,
    [EnumMember(Value = "oval")] Oval
}
public sealed record SceneRequest(
    IReadOnlyList<long>? ElementIds = null,
    double ContextPaddingFt = 15,
    int MaxTriangles = 1500000,
    Aabb? Bounds = null,
    bool FocusOnly = false,
    bool Proximity = false,
    SceneContextRepresentation ContextRepresentation = SceneContextRepresentation.Boxes
);

/// <summary>Straight physical run. Points and dimensions use host internal feet; X is the unit width axis.</summary>
public sealed record SceneRun(IReadOnlyList<double> Start, IReadOnlyList<double> End, SceneRunShape Shape,
    double? WidthFt, double? HeightFt, double? DiameterFt, IReadOnlyList<double> CrossSectionXAxis);
public sealed record SceneElement(Handle Handle, int FirstVertex, int VertexCount, Aabb Bounds, bool Focus, long? CategoryId,
    SceneRepresentation Representation, SceneRun? Run);
public sealed record SceneSource(string DocumentKey, long? LinkInstanceId, IReadOnlyList<double> SourceToHost);
public sealed record SceneUnavailableElement(long ElementId, string? UniqueId, string? Category, string Reason);
public sealed record SceneMetadata(string Format, Stamp Stamp, Aabb Bounds, int Triangles,
    IReadOnlyList<SceneElement> Elements, IReadOnlyList<long> RequestedElementIds, int OmittedElements,
    IReadOnlyList<SceneSource> Sources, string Phase, IReadOnlyList<SceneUnavailableElement> UnavailableElements,
    SceneWork Work, SceneCompleteness Completeness);
/// <param name="DeferredCandidates">Known unacquired candidates, or null when discovery stopped before the remaining count was known.</param>
public sealed record SceneCompleteness(bool Complete, int? DeferredCandidates, int AcquisitionLimitedElements, string? LimitReason);
public sealed record SceneMemory(long StartPrivateBytes, long EndPrivateBytes, long PeakPrivateBytes, long ManagedBytes);
public sealed record SceneWork(int BroadCandidates, int ExtractedElements, int ExtractedTriangles, double NativeMilliseconds,
    int PeakRetainedTriangles = 0, int NativeGeometryCalls = 0, SceneMemory? Memory = null,
    int AcquiredTriangles = 0, int ContextGeometryCalls = 0);
public sealed record SceneArtifact(SceneMetadata Scene, string Id, string Url, long Bytes);

/// <summary>Bounded native meshes and explicit scene primitives in host internal feet.</summary>
public static class Scene {
    public static SceneMetadata Write(Document document, SceneRequest request, Stream vertices, System.Threading.CancellationToken cancellationToken = default) {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        if (request.MaxTriangles is < 1 or > 3000000)
            throw new ArgumentException("maxTriangles must be between 1 and 3000000.");
        if (!Enum.IsDefined(typeof(SceneContextRepresentation), request.ContextRepresentation))
            throw new ArgumentException("contextRepresentation must be none, boxes or meshes.");
        if (!Finite(request.ContextPaddingFt) || request.ContextPaddingFt is < 0 or > 1000)
            throw new ArgumentException("contextPaddingFt must be between 0 and 1000.");
        if (request.Bounds is { } b && (!Finite(b.MinX, b.MinY, b.MinZ, b.MaxX, b.MaxY, b.MaxZ)
            || b.MinX >= b.MaxX || b.MinY >= b.MaxY || b.MinZ >= b.MaxZ))
            throw new ArgumentException("bounds must be finite ordered host-internal-ft bounds.");
        var ids = new HashSet<long>(request.ElementIds ?? []);
        if (request.Proximity && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("proximity requires elementIds and cannot specify bounds.");
        if (request.FocusOnly && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("focusOnly requires elementIds and cannot specify bounds.");
        var context = request.FocusOnly ? SceneContextRepresentation.None : request.ContextRepresentation;
        if (context == SceneContextRepresentation.Meshes && ids.Count == 0 && request.Bounds is null)
            throw new ArgumentException("meshes context requires elementIds or explicit bounds.");
        var budget = new SceneBudget(request.MaxTriangles, cancellationToken);
        var world = SpaceWorld.SceneSources(document);
        foreach (var partition in world.Partitions) partition.BeginScene(world.CurrentEpoch);
        var leases = new Dictionary<Partition, IDisposable?>();
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
        var elements = new List<SceneElement>();
        var triangles = 0;
        var writtenBounds = Aabb.Empty;
        var crop = request.Bounds;
        using var writer = new BinaryWriter(vertices, System.Text.Encoding.UTF8, true);
        LinkedGeometryStore.Geometry Capture(Partition partition, Element element, Aabb? region, bool coarse = false) {
            if (!coarse && !leases.ContainsKey(partition)) leases[partition] = partition.OpenScene();
            var captured = partition.CaptureScene(element, region, budget, coarse);
            extracted++;
            extractedTriangles += captured.Triangles.Length;
            partition.RecordScene(captured);
            budget.Retained(focusCount + captured.Triangles.Length);
            return captured;
        }
        void Primitive(Partition partition, Element element, Aabb bounds, SceneRun? run, bool isFocus) {
            if (crop is { } region && !bounds.Overlaps(region)) return;
            var row = new PrimRow(partition.Source, element.Id.Value(), element.UniqueId, element.Category?.Name ?? "<none>",
                PrimKind.Element, bounds, 0, HeightRole: HeightRoles.Of(element.Category?.Id.Value(), element is ImportInstance));
            elements.Add(new SceneElement(partition.HandleFor(row), triangles * 3, 0, bounds, isFocus,
                element.Category?.Id.Value(), run is null ? SceneRepresentation.Box : SceneRepresentation.Run, run));
            partition.RecordScene(new LinkedGeometryStore.Geometry([row], []));
            writtenBounds = Union(writtenBounds, bounds);
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
                    runs.Add((world.Partitions[0], element, runBounds, run));
                    focusBounds = Union(focusBounds, runBounds);
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
            if (ids.Count > 0 && focus.Count + runs.Count == 0 && crop is null)
                throw new ArgumentException("None of the requested elementIds produced a visible host representation.");
            if (context != SceneContextRepresentation.None && crop is null && focus.Count + runs.Count > 0)
                crop = focusBounds.Expand(request.ContextPaddingFt);
            var focusGeometryCalls = budget.GeometryCalls;
            var index = new SceneFocusIndex(focus.Select(row => row.Row.Box).Concat(runs.Select(row => row.Bounds)).ToArray());
            var runIndex = new SceneFocusIndex(runs.Select(row => row.Bounds).ToArray());
            var proximity = context == SceneContextRepresentation.Meshes && focus.Count > 0
                ? Bvh.Build(focus.SelectMany(row => row.Triangles).ToArray()) : null;
            void Write(Partition partition, PrimRow row, Tri[] source, bool isFocus) {
                if (crop is { } region && !row.Box.Overlaps(region)) return;
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
                if (kept.Count == 0) return;
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
                bool Take(Tri triangle) {
                    if (triangles + kept.Count >= request.MaxTriangles) {
                        if (isFocus) throw new ArgumentException("Selected mesh exceeds maxTriangles; narrow elementIds or raise the budget.");
                        omitted++; limit ??= "output-budget";
                        stopped = true;
                        return false;
                    }
                    kept.Add(triangle); bounds = Union(bounds, Box(triangle));
                    budget.Retained(focusCount + source.Length + kept.Count);
                    return true;
                }
            }
            foreach (var row in focus) Write(row.Source, row.Row, row.Triangles, true);
            foreach (var row in runs) Primitive(row.Source, row.Element, row.Bounds, row.Run, true);
            if (context != SceneContextRepresentation.None) {
                var candidates = new List<(Partition Source, long Id, Aabb Bounds, double Distance)>();
                foreach (var partition in world.Partitions) {
                    foreach (var element in partition.SceneElements(crop)) {
                        budget.Check();
                        broad++;
                        if (partition.Kind == SourceKind.Host && ids.Contains(element.Id.Value())) continue;
                        if (!Ingest.Allowed(element)) continue;
                        var bounds = partition.SceneBounds(element);
                        if (bounds is null) { omitted++; limit ??= "missing-bounds"; continue; }
                        if (ids.Count > 0 && (request.Proximity || context == SceneContextRepresentation.Meshes)
                            && !index.Overlaps(bounds.Value, request.ContextPaddingFt)) continue;
                        // ETW showed Revit retains native tessellation allocations; bound what we ask it to tessellate.
                        // Bounds/runs never enter mesh capture or acquire a geometry cache lease.
                        if (context == SceneContextRepresentation.Boxes) {
                            Primitive(partition, element, bounds.Value, ReadRun(element, partition.Transform), false);
                            continue;
                        }
                        candidates.Add((partition, element.Id.Value(), bounds.Value, index.DistanceSquared(bounds.Value)));
                    }
                }
                candidates = candidates.OrderBy(row => row.Distance).ToList();
                for (var i = 0; i < candidates.Count; i++) {
                    if (triangles >= request.MaxTriangles) { deferred += candidates.Count - i; limit ??= "output-budget"; break; }
                    var candidate = candidates[i];
                    var element = candidate.Source.Doc.GetElement(candidate.Id.ToElementId());
                    if (element is null) { omitted++; limit ??= "missing-element"; continue; }
                    try {
                        budget.Check();
                        var captured = Capture(candidate.Source, element, crop, true);
                        foreach (var row in captured.Rows) Write(candidate.Source, row, captured.Triangles, false);
                    } catch (SceneLimitException ex) {
                        limited++; limit = ex.Reason;
                        if (ex.Reason != "element-acquisition-limit") { deferred += candidates.Count - i - 1; break; }
                    }
                }
            }
            if (elements.Count == 0) {
                if (limit is not null) throw new InvalidOperationException($"Scene acquisition stopped ({limit}) before a representation could be published.");
                throw new ArgumentException("No representation fits this scope and triangle budget.");
            }
            return new SceneMetadata("space-scene-v3", world.StampFor(world.Partitions, Filter.Default), crop ?? writtenBounds,
                triangles, elements, ids.ToList(), omitted, world.Partitions.Select(p => {
                    var t = p.Transform;
                    return new SceneSource(p.DocumentKey, p.LinkInstanceId, new[] {
                        t.BasisX.X, t.BasisX.Y, t.BasisX.Z, 0, t.BasisY.X, t.BasisY.Y, t.BasisY.Z, 0,
                        t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z, 0, t.Origin.X, t.Origin.Y, t.Origin.Z, 1
                    });
                }).ToList(), context == SceneContextRepresentation.None ? "focus" : "context", unavailable,
                new SceneWork(broad, extracted, extractedTriangles, clock.Elapsed.TotalMilliseconds,
                    budget.PeakRetainedTriangles, budget.NativeCalls, budget.Diagnostics(), budget.NativeTriangles,
                    budget.GeometryCalls - focusGeometryCalls),
                new SceneCompleteness(limit is null, deferred, limited, limit));
        } finally {
            foreach (var lease in leases.Values) lease?.Dispose();
            LinkedGeometryStore.Prune();
        }
    }

    internal static SceneRun? ReadRun(Element element, Transform transform) {
        // Insulation also inherits MEPCurve. Only these physical rigid types have a supported run contract.
        if (element is not (Duct or Pipe or Conduit or CableTray) || element is not MEPCurve curve) return null;
        try {
            if (curve.Location is not LocationCurve { Curve: Line line }) return null;
            var localStart = line.GetEndPoint(0);
            var start = transform.OfPoint(localStart);
            var end = transform.OfPoint(line.GetEndPoint(1));
            var tangent = (end - start).Normalize();
            using var manager = curve.ConnectorManager;
            using var connectors = manager.Connectors;
            var connector = connectors.Cast<Connector>().Where(c => c.ConnectorType == ConnectorType.End)
                .OrderBy(c => c.Origin.DistanceTo(localStart)).FirstOrDefault();
            if (connector is null) return null;
            using (connector) {
                var shape = connector.Shape switch {
                    ConnectorProfileType.Round => SceneRunShape.Round,
                    ConnectorProfileType.Rectangular => SceneRunShape.Rectangular,
                    ConnectorProfileType.Oval => SceneRunShape.Oval,
                    _ => (SceneRunShape?)null
                };
                if (shape is null) return null;
                double? width = shape == SceneRunShape.Round ? null : connector.Width;
                double? height = shape == SceneRunShape.Round ? null : connector.Height;
                double? diameter = shape == SceneRunShape.Round ? connector.Radius * 2 : null;
                if (new[] { width, height, diameter }.Any(size => size is { } value && (!Finite(value) || value <= 0))) return null;
                using var frame = connector.CoordinateSystem;
                var x = transform.OfVector(frame.BasisX).Normalize();
                if (!Finite(start.X, start.Y, start.Z, end.X, end.Y, end.Z, x.X, x.Y, x.Z)
                    || start.DistanceTo(end) <= 1e-9 || Math.Abs(x.DotProduct(tangent)) > 1e-6) return null;
                return new SceneRun([start.X, start.Y, start.Z], [end.X, end.Y, end.Z], shape.Value,
                    width, height, diameter, [x.X, x.Y, x.Z]);
            }
        } catch { return null; } // Unsupported native size/frame retains mesh focus or box context.
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
