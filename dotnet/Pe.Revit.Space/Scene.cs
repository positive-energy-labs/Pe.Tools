using System.IO;
using System.Numerics;

namespace Pe.Revit.Space;

public sealed record SceneRequest(
    IReadOnlyList<long>? ElementIds = null,
    double ContextPaddingFt = 15,
    int MaxTriangles = 1500000,
    Aabb? Bounds = null,
    bool FocusOnly = false
);

public sealed record SceneElement(Handle Handle, int FirstVertex, int VertexCount, Aabb Bounds, bool Focus);
public sealed record SceneSource(string DocumentKey, long? LinkInstanceId, IReadOnlyList<double> SourceToHost);
public sealed record SceneUnavailableElement(long ElementId, string? UniqueId, string? Category, string Reason);
public sealed record SceneMetadata(string Format, Stamp Stamp, Aabb Bounds, int Triangles,
    IReadOnlyList<SceneElement> Elements, IReadOnlyList<long> RequestedElementIds, int OmittedElements,
    IReadOnlyList<SceneSource> Sources, string Phase, IReadOnlyList<SceneUnavailableElement> UnavailableElements);
public sealed record SceneArtifact(SceneMetadata Scene, string Id, string Url, long Bytes);

/// <summary>Bounded real triangles. Coordinates remain host internal feet.</summary>
public static class Scene {
    public static SceneMetadata Write(Document document, SceneRequest request, Stream vertices) {
        if (request.MaxTriangles is < 1 or > 3000000)
            throw new ArgumentException("maxTriangles must be between 1 and 3000000.");
        if (double.IsNaN(request.ContextPaddingFt) || double.IsInfinity(request.ContextPaddingFt)
            || request.ContextPaddingFt is < 0 or > 1000)
            throw new ArgumentException("contextPaddingFt must be between 0 and 1000.");
        if (request.Bounds is { } b && (!Finite(b.MinX, b.MinY, b.MinZ, b.MaxX, b.MaxY, b.MaxZ)
            || b.MinX >= b.MaxX || b.MinY >= b.MaxY || b.MinZ >= b.MaxZ))
            throw new ArgumentException("bounds must be finite ordered host-internal-ft bounds.");

        var ids = new HashSet<long>(request.ElementIds ?? []);
        if (request.FocusOnly && (ids.Count == 0 || request.Bounds is not null))
            throw new ArgumentException("focusOnly requires elementIds and cannot specify bounds.");
        var crop = request.Bounds;
        var world = SpaceWorld.PrepareScene(document, ids, ref crop, request.ContextPaddingFt, request.FocusOnly);
        var rows = world.Partitions.SelectMany(p => p.Prims.Select((row, i) => (Partition: p, Row: row, Index: i)))
            .Where(x => x.Row.Kind is PrimKind.Solid or PrimKind.Mesh).ToList();
        var available = new HashSet<long>(world.SceneFocusMeshIds
            ?? rows.Where(x => x.Partition.Kind == SourceKind.Host).Select(x => x.Row.ElementId).ToArray());
        var unavailable = ids.Where(id => !available.Contains(id)).Select(id => {
            var element = document.GetElement(id.ToElementId());
            return new SceneUnavailableElement(id, element?.UniqueId, element?.Category?.Name,
                element is null ? "Element is absent from this document." : "No visible mesh was produced at Medium or Fine detail.");
        }).ToList();
        var focusBounds = rows.Where(x => x.Partition.Kind == SourceKind.Host && ids.Contains(x.Row.ElementId))
            .Select(x => x.Row.Box).DefaultIfEmpty(crop ?? Aabb.Empty).Aggregate(Union);
        var candidates = rows.Where(x => crop is null || x.Row.Box.Overlaps(crop.Value))
            .OrderByDescending(x => x.Partition.Kind == SourceKind.Host && ids.Contains(x.Row.ElementId))
            .ThenBy(x => focusBounds.DistanceSquared(x.Row.Box)).ToList();
        var elements = new List<SceneElement>();
        var triangles = 0;
        var omitted = 0;
        var bounds = Aabb.Empty;
        using var writer = new BinaryWriter(vertices, System.Text.Encoding.UTF8, true);
        foreach (var x in candidates) {
            var isFocus = x.Partition.Kind == SourceKind.Host && ids.Contains(x.Row.ElementId);
            var kept = new List<Tri>();
            var elementBounds = Aabb.Empty;
            var overBudget = false;
            for (var i = x.Partition.Starts[x.Index]; i < x.Partition.Starts[x.Index + 1] && !overBudget; i++) {
                var t = x.Partition.Tris[i];
                foreach (var clipped in crop is { } box ? Clip(t, box) : new[] { t }) {
                    if (triangles + kept.Count >= request.MaxTriangles) { overBudget = true; break; }
                    kept.Add(clipped);
                    elementBounds = Union(elementBounds, Box(clipped));
                }
            }
            if (overBudget) {
                if (isFocus) throw new ArgumentException("Selected mesh exceeds maxTriangles; narrow elementIds or raise the budget.");
                omitted++;
                continue;
            }
            if (kept.Count == 0) continue;
            elements.Add(new SceneElement(x.Partition.HandleFor(x.Row), triangles * 3, kept.Count * 3, elementBounds, isFocus));
            foreach (var t in kept) {
                writer.Write(t.A.X); writer.Write(t.A.Y); writer.Write(t.A.Z);
                writer.Write(t.B.X); writer.Write(t.B.Y); writer.Write(t.B.Z);
                writer.Write(t.C.X); writer.Write(t.C.Y); writer.Write(t.C.Z);
            }
            bounds = Union(bounds, elementBounds);
            triangles += kept.Count;
        }
        if (triangles == 0) throw new ArgumentException("No mesh fits this scope and triangle budget.");
        return new SceneMetadata("space-scene-v1", world.StampFor(world.Partitions, Filter.Default), crop ?? bounds,
            triangles, elements, ids.ToList(), omitted, world.Partitions.Select(p => {
                var t = p.Transform;
                // Column-major affine matrix. Vertices already include this transform; consumers must not apply it again.
                return new SceneSource(p.DocumentKey, p.LinkInstanceId, new[] {
                    t.BasisX.X, t.BasisX.Y, t.BasisX.Z, 0,
                    t.BasisY.X, t.BasisY.Y, t.BasisY.Z, 0,
                    t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z, 0,
                    t.Origin.X, t.Origin.Y, t.Origin.Z, 1
                });
            }).ToList(), request.FocusOnly ? "focus" : "context", unavailable);
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
