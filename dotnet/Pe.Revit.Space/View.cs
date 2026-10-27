namespace Pe.Revit.Space;

/// <summary>
///     The world as a picture, for a browser that draws it. Every answer here is a projection of
///     operation-owned rows and BVH nodes. Status alone does not capture geometry.
/// </summary>
public static class SpaceView {
    private static readonly Filter AllKinds = new(Kinds: [PrimKind.Solid, PrimKind.Mesh, PrimKind.Curve2D]);

    /// <summary>The filter as the wire spells it: enum names as strings, every axis optional.</summary>
    public sealed record FilterRequest(
        IReadOnlyList<string>? Sources = null,
        IReadOnlyList<string>? Categories = null,
        IReadOnlyList<string>? Kinds = null,
        IReadOnlyList<string>? Layers = null,
        IReadOnlyList<long>? ExcludeElementIds = null
    ) {
        public Filter ToFilter() => new(
            this.Sources?.Select(s => (SourceKind)Enum.Parse(typeof(SourceKind), s, true)).ToList(),
            this.Categories,
            this.Kinds?.Select(k => (PrimKind)Enum.Parse(typeof(PrimKind), k, true)).ToList(),
            this.Layers,
            this.ExcludeElementIds);
    }

    /// <summary>One host level and its project elevation in host internal feet.</summary>
    public sealed record LevelRow(string Name, double ElevationFt);

    /// <summary>One partition's categories, so a filter can be built without a rows read.</summary>
    public sealed record SourceCategories(int Source, IReadOnlyList<string> Categories);

    /// <summary>
    ///     Summary of the operation's capture. Status alone reports Built false because it does not
    ///     capture geometry. Other query operations prepare their own World. Bounds union captured row boxes.
    /// </summary>
    public sealed record StatusAnswer(
        Stamp Stamp,
        bool Built,
        int PendingIds,
        IReadOnlyList<SourceCategories> Categories,
        IReadOnlyList<LevelRow> Levels,
        Aabb? Bounds,
        double Ms
    );

    /// <summary>
    ///     Every row that passes the filter, as parallel arrays: index i across every array is one
    ///     <see cref="PrimRow" />. Category, kind, layer and height role are indexes into the legend
    ///     lists, so a category name travels once. Box is six doubles per row; -1 means no layer.
    /// </summary>
    public sealed record RowsAnswer(
        Stamp Stamp,
        Searched Searched,
        IReadOnlyList<string> Categories,
        IReadOnlyList<string> Kinds,
        IReadOnlyList<string> Layers,
        IReadOnlyList<string> HeightRoles,
        int[] Source,
        long[] ElementId,
        int[] Category,
        int[] Kind,
        int[] Layer,
        int[] HeightRole,
        int[] Triangles,
        double[] ExtrusionFt,
        double[] Box,
        double Ms
    );

    /// <summary>
    ///     A <see cref="SliceAnswer" /> cut to a piece budget, whole elements or nothing, for the
    ///     browser frame budget: a knee band across a whole storey is 164 k pieces. <see cref="Total" /> is what the slice found regardless.
    /// </summary>
    public sealed record SliceCapped(
        Stamp Stamp,
        Searched Searched,
        IReadOnlyList<SliceElement> Elements,
        int Pieces,
        int Total,
        bool Truncated,
        double Ms
    );

    public static SliceCapped Slice(Document document, double z0, double z1, Filter filter, Aabb? xyClip, int maxPieces) {
        if (maxPieces < 0) throw new ArgumentOutOfRangeException(nameof(maxPieces));
        var full = Verbs.Slice(document, z0, z1, filter, xyClip);
        var kept = new List<SliceElement>();
        var pieces = 0;
        var truncated = false;
        foreach (var el in full.Elements) {
            if (pieces + el.Pieces.Count > maxPieces) {
                truncated = true;
                break;
            }
            kept.Add(el);
            pieces += el.Pieces.Count;
        }
        return new SliceCapped(full.Stamp, full.Searched, kept, pieces, full.Pieces, truncated, full.Ms);
    }

    /// <summary>One source BVH, through MaxDepth inclusive, in post-order with the root last.</summary>
    public sealed record TreeAnswer(Stamp Stamp, int Source, int MaxDepth, IReadOnlyList<BvhNode> Nodes, double Ms);

    public static StatusAnswer Status(Document document) => Status(document, new World(document.GetDocumentKey(), SpaceWorld.Epoch(document)));

    public static StatusAnswer Status(Document document, World world) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var built = world.BuiltUtc != default;
        var bounds = Aabb.Empty;
        var any = false;
        foreach (var p in world.Partitions)
            foreach (var row in p.Prims) {
                any = true;
                bounds = new Aabb(
                    Math.Min(bounds.MinX, row.Box.MinX), Math.Min(bounds.MinY, row.Box.MinY), Math.Min(bounds.MinZ, row.Box.MinZ),
                    Math.Max(bounds.MaxX, row.Box.MaxX), Math.Max(bounds.MaxY, row.Box.MaxY), Math.Max(bounds.MaxZ, row.Box.MaxZ));
            }

        var levels = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
            .OrderBy(l => l.ProjectElevation).Select(l => new LevelRow(l.Name, l.ProjectElevation)).ToList();
        sw.Stop();
        return new StatusAnswer(
            world.StampFor(world.Partitions, AllKinds),
            built,
            0,
            world.Partitions.Select(p => new SourceCategories(p.Source, p.Categories)).ToList(),
            levels,
            any ? bounds : null,
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    public static RowsAnswer Rows(Document document, Filter filter) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Prepare(document);
        var touched = world.Partitions.Where(p => filter.Wants(p.Kind)).ToList();

        var categories = new Legend();
        var kinds = new Legend();
        var layers = new Legend();
        var roles = new Legend();
        var source = new List<int>();
        var elementId = new List<long>();
        var category = new List<int>();
        var kind = new List<int>();
        var layer = new List<int>();
        var role = new List<int>();
        var triangles = new List<int>();
        var extrusion = new List<double>();
        var box = new List<double>();
        int candidates = 0, skipped = 0;

        foreach (var p in touched)
            foreach (var row in p.Prims) {
                candidates++;
                if (!filter.Wants(row)) {
                    skipped++;
                    continue;
                }

                source.Add(p.Source);
                elementId.Add(row.ElementId);
                category.Add(categories.Of(row.Category));
                kind.Add(kinds.Of(row.Kind.ToString()));
                layer.Add(row.Layer is null ? -1 : layers.Of(row.Layer));
                role.Add(roles.Of(row.HeightRole.ToString()));
                triangles.Add(row.Triangles);
                extrusion.Add(row.Extrusion?.MaxHeightFt ?? 0);
                box.AddRange([
                    R(row.Box.MinX), R(row.Box.MinY), R(row.Box.MinZ), R(row.Box.MaxX), R(row.Box.MaxY), R(row.Box.MaxZ)
                ]);
            }

        sw.Stop();
        return new RowsAnswer(
            world.StampFor(touched, filter),
            new Searched(touched.Count, categories.Count, candidates, candidates - skipped, skipped),
            categories.Names, kinds.Names, layers.Names, roles.Names,
            source.ToArray(), elementId.ToArray(), category.ToArray(), kind.ToArray(), layer.ToArray(), role.ToArray(),
            triangles.ToArray(), extrusion.ToArray(), box.ToArray(),
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    public static TreeAnswer Tree(Document document, int source, int maxDepth) {
        if (maxDepth < 0) throw new ArgumentOutOfRangeException(nameof(maxDepth));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var world = SpaceWorld.Prepare(document);
        var partition = world.Partitions.FirstOrDefault(p => p.Source == source)
            ?? throw new ArgumentOutOfRangeException(nameof(source), $"no partition with source {source}");
        var nodes = partition.Bvh.Walk(maxDepth);
        sw.Stop();
        return new TreeAnswer(world.StampFor([partition], AllKinds with { Sources = [partition.Kind] }), source, maxDepth, nodes,
            Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    private static double R(double v) => Math.Round(v, 3);

    private sealed class Legend {
        private readonly Dictionary<string, int> _index = new(StringComparer.Ordinal);
        public List<string> Names { get; } = [];
        public int Count => this.Names.Count;

        public int Of(string name) {
            if (this._index.TryGetValue(name, out var i)) return i;
            this._index[name] = i = this.Names.Count;
            this.Names.Add(name);
            return i;
        }
    }
}
