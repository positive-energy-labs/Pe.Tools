using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Space;

/// <summary>Operation-owned geometry. Only change epochs outlive the caller.</summary>
public static class SpaceWorld {
    private static readonly Dictionary<string, ChangeState> States = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Sync = new();

    public static void Wire(IDocumentTracker documents) {
        documents.Changed += (tracked, change) => {
            lock (Sync) {
                var key = tracked.Resolve().GetDocumentKey();
                var state = State(key);
                state.Epoch++;
                if (change.GetAddedElementIds().Concat(change.GetModifiedElementIds()).Concat(change.GetDeletedElementIds())
                    .Any(id => state.LinkIds.Contains(id.Value()))) state.Generation = Guid.NewGuid().ToString("N");
            }
        };
        documents.Closed += key => { lock (Sync) States.Remove(key.Value); };
    }

    public static World Build(Document document) => Prepare(document);

    public static World Prepare(Document document) {
        var world = new World(document.GetDocumentKey(), Epoch(document));
        world.BuildAll(document);
        LinkedGeometryStore.Prune();
        return world;
    }

    internal static World PrepareScene(Document document, IReadOnlyCollection<long> ids, ref Aabb? crop, double padding, bool focusOnly, bool proximity = false) {
        if (crop is null && ids.Count == 0) return Prepare(document);
        var world = new World(document.GetDocumentKey(), Epoch(document));
        world.BuildScope(document, ids, ref crop, padding, world.CurrentEpoch, focusOnly, proximity);
        LinkedGeometryStore.Prune();
        return world;
    }

    public static long Epoch(Document document) {
        lock (Sync) return State(document.GetDocumentKey()).Epoch;
    }

    internal static string? HostGeneration(Document document) {
        // Descriptive document keys survive reopening; only the SDK authority identifies this native open lifetime.
        if (!PeDocumentIdentity.TryGetOpenId(document, out var openId)) return null;
        return $"{openId}:{Epoch(document)}";
    }
    private sealed class ChangeState {
        public long Epoch;
        public string Generation = Guid.NewGuid().ToString("N");
        public string Manifest = "";
        public HashSet<long> LinkIds = [];
    }

    private static ChangeState State(string key) {
        if (!States.TryGetValue(key, out var state)) States[key] = state = new ChangeState();
        return state;
    }

    internal static string LinkGeneration(Document host, IReadOnlyList<RevitLinkInstance> links) {
        // Loaded documents and worksets are reconciled every operation, including unload/reload without an instance-id delta.
        var manifest = string.Join("|", links.OrderBy(l => l.UniqueId, StringComparer.Ordinal).Select(link => {
            var doc = link.GetLinkDocument();
            var worksets = doc is null ? "unloaded" : string.Join(",", new FilteredWorksetCollector(doc)
                .OfKind(WorksetKind.UserWorkset).ToWorksets().OrderBy(w => w.Id.IntegerValue)
                .Select(w => $"{w.Id.IntegerValue}:{w.IsOpen}"));
            return $"{link.UniqueId}:{link.GetTypeId()}:{doc?.GetDocumentKey()}:{worksets}";
        }));
        lock (Sync) {
            var state = State(host.GetDocumentKey());
            if (state.Manifest != manifest) { state.Manifest = manifest; state.Generation = Guid.NewGuid().ToString("N"); }
            state.LinkIds = new HashSet<long>(links.SelectMany(l => new[] { l.Id.Value(), l.GetTypeId().Value() }));
            return state.Generation;
        }
    }

}

/// <summary>One operation's source documents, triangles and query indexes.</summary>
public sealed class World {
    private readonly List<Partition> _partitions = [];

    internal World(string hostKey, long epoch) { this.HostDocumentKey = hostKey; this.CurrentEpoch = epoch; }
    public string HostDocumentKey { get; }
    public long CurrentEpoch { get; private set; }
    public DateTime BuiltUtc { get; private set; }
    internal IReadOnlyList<Partition> Partitions => this._partitions;
    internal Document HostDocument => this._partitions[0].Doc;
    internal IReadOnlyCollection<long>? SceneFocusMeshIds { get; private set; }

    internal void BuildAll(Document host) {
        {
            this._partitions.Clear();
            this._partitions.Add(new Partition(0, host, SourceKind.Host, null, Transform.Identity, SpaceWorld.HostGeneration(host)));

            var links = new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().ToList();
            var generation = SpaceWorld.LinkGeneration(host, links);
            var source = 1;
            foreach (var li in links) {
                var ld = li.GetLinkDocument();
                if (ld is null) continue;
                var kind = ld.Title.IndexOf(".ifc", StringComparison.OrdinalIgnoreCase) >= 0
                    ? SourceKind.IfcLink
                    : SourceKind.RevitLink;
                this._partitions.Add(new Partition(source++, ld, kind, li.Id.Value(), li.GetTotalTransform(), generation));
            }

            foreach (var p in this._partitions) p.Build(this.CurrentEpoch);
            this.BuiltUtc = DateTime.UtcNow;
        }
    }

    internal void BuildScope(Document host, IReadOnlyCollection<long> ids, ref Aabb? crop, double padding, long epoch, bool focusOnly, bool proximity = false) {
        this.CurrentEpoch = epoch;
        this._partitions.Add(new Partition(0, host, SourceKind.Host, null, Transform.Identity, SpaceWorld.HostGeneration(host)));
        if (focusOnly) {
            this._partitions[0].BuildElements(ids.Select(id => host.GetElement(id.ToElementId())).OfType<Element>(), epoch);
            this.BuiltUtc = DateTime.UtcNow;
            return;
        }
        var links = new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().ToList();
        var generation = SpaceWorld.LinkGeneration(host, links);
        var source = 1;
        foreach (var link in links) {
            var linked = link.GetLinkDocument();
            if (linked is null) continue;
            var kind = linked.Title.IndexOf(".ifc", StringComparison.OrdinalIgnoreCase) >= 0 ? SourceKind.IfcLink : SourceKind.RevitLink;
            this._partitions.Add(new Partition(source++, linked, kind, link.Id.Value(), link.GetTotalTransform(), generation));
        }
        if (ids.Count > 0) {
            var focus = this._partitions[0];
            focus.BuildElements(ids.Select(id => host.GetElement(id.ToElementId())).OfType<Element>(), epoch);
            this.SceneFocusMeshIds = focus.Prims.Select(row => row.ElementId).ToArray();
            this.ResolveSceneCrop(ids, ref crop, padding);
        }
        if (crop is not { } region) throw new ArgumentException("A contextual scene requires mesh-bearing ids or bounds.");
        var local = proximity ? this._partitions[0].Prims.Select(p => p.Box.Expand(padding)).ToArray() : null;
        foreach (var partition in this._partitions) partition.BuildRegion(region, epoch, local);
        this.BuiltUtc = DateTime.UtcNow;
    }

    internal void ResolveSceneCrop(IReadOnlyCollection<long> ids, ref Aabb? crop, double padding) {
        if (ids.Count == 0) return;
        var wanted = new HashSet<long>(ids);
        var focus = this._partitions[0].Prims.Where(row => row.Kind is PrimKind.Solid or PrimKind.Mesh)
            .Where(row => wanted.Contains(row.ElementId)).ToList();
        if (focus.Count == 0 && crop is null)
            throw new ArgumentException("None of the requested elementIds produced a visible host mesh.");
        if (crop is not null) return;
        var bounds = Aabb.Empty;
        foreach (var row in focus)
            bounds = bounds.Include(new Vector3((float)row.Box.MinX, (float)row.Box.MinY, (float)row.Box.MinZ))
                .Include(new Vector3((float)row.Box.MaxX, (float)row.Box.MaxY, (float)row.Box.MaxZ));
        crop = bounds.Expand(padding);
    }

    internal Stamp StampFor(IEnumerable<Partition> touched, Filter filter) {
        var seen = touched as IReadOnlyList<Partition> ?? touched.ToList();
        return new Stamp(this.HostDocumentKey, this.CurrentEpoch, Stamp.HostInternalFt, this.BuiltUtc,
            this._partitions.Select(p => p.Row).ToList(), this.BuiltUtc != default, Resolve(seen, filter));
    }

    /// <summary>
    ///     Spells out the gate the verb ran under. A null axis on the filter is replaced by what the
    ///     default actually means: every partition kind in the world, every category the touched
    ///     partitions hold, and the two obstructing kinds. A caller must never have to guess.
    /// </summary>
    private Resolved Resolve(IReadOnlyList<Partition> touched, Filter filter) => new(
        filter.Sources?.ToList() ?? this._partitions.Select(p => p.Kind).Distinct().ToList(),
        filter.Categories?.ToList()
        ?? touched.SelectMany(p => p.Categories).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList(),
        filter.Kinds?.ToList() ?? [PrimKind.Solid, PrimKind.Mesh],
        // Layers are echoed only when they were a gate. Empty means no layer restriction was in
        // force, which the Kinds line already makes decisive: without Curve2D nothing has a layer.
        filter.Layers?.ToList() ?? [],
        filter.ExcludeElementIds?.ToList() ?? []);
}
