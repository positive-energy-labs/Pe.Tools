using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Space;

/// <summary>
///     The resident triangle soup. One <see cref="World" /> per host document, held in the Revit
///     process, built once by an explicit <see cref="Build(Document)" /> and refreshed per element
///     from the SDK document tracker. Read only: there is no transaction anywhere in this library.
/// </summary>
public static class SpaceWorld {
    private static readonly Dictionary<string, World> Worlds = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Sync = new();

    /// <summary>
    ///     Subscribes to the tracker. Called once by AppCore next to DocumentCacheMaintenance.Wire.
    ///     The epoch is minted here and nowhere else, one per Changed event. Nothing is tessellated
    ///     inside the handler; the delta is queued and applied on the next verb call.
    /// </summary>
    public static void Wire(IDocumentTracker documents) {
        documents.Changed += (tracked, e) => {
            var doc = tracked.Resolve();
            lock (Sync) {
                if (!Worlds.TryGetValue(doc.GetDocumentKey(), out var world)) return;
                world.Enqueue(e);
            }
        };
        documents.Closed += key => {
            lock (Sync) _ = Worlds.Remove(key.Value);
        };
    }

    /// <summary>The one explicit ingest of every partition. Nothing else builds.</summary>
    public static World Build(Document document) {
        var world = Resident(document);
        world.BuildAll(document);
        return world;
    }

    /// <summary>Explicit operation preparation: patch host edits and rebuild unbuilt or dirty linked sources.</summary>
    public static World Prepare(Document document) {
        var world = Resident(document);
        world.ApplyQueued();
        if (world.BuiltUtc == default || world.Partitions.Any(partition => partition.Dirty))
            world.BuildAll(document);
        return world;
    }

    // A scene snapshot does not populate the query world or need its triangle BVH.
    internal static World PrepareScene(Document document, IReadOnlyCollection<long> ids, ref Aabb? crop, double padding, bool focusOnly) {
        if (crop is null && ids.Count == 0) return Prepare(document);
        var resident = Resident(document);
        if (!focusOnly && resident.Prepared) {
            resident.ResolveSceneCrop(ids, ref crop, padding);
            return resident;
        }
        var world = new World(document.GetDocumentKey());
        world.BuildScope(document, ids, ref crop, padding, resident.CurrentEpoch, focusOnly);
        return world;
    }

    /// <summary>The world for this host document, created empty if it does not exist yet.</summary>
    public static World Resident(Document document) {
        lock (Sync) {
            var key = document.GetDocumentKey();
            if (!Worlds.TryGetValue(key, out var world)) Worlds[key] = world = new World(key);
            return world;
        }
    }

    /// <summary>The current epoch without touching geometry. Zero when nothing is resident.</summary>
    public static long Epoch(Document document) {
        lock (Sync) return Worlds.TryGetValue(document.GetDocumentKey(), out var w) ? w.CurrentEpoch : 0L;
    }
}

/// <summary>One host document's partitions, epoch, and pending delta.</summary>
public sealed class World {
    private readonly List<Partition> _partitions = [];
    private readonly HashSet<long> _added = [];
    private readonly HashSet<long> _modified = [];
    private readonly HashSet<long> _deleted = [];
    private readonly object _sync = new();

    internal World(string hostKey) => this.HostDocumentKey = hostKey;

    public string HostDocumentKey { get; }
    public long CurrentEpoch { get; private set; }
    public DateTime BuiltUtc { get; private set; }

    internal IReadOnlyList<Partition> Partitions => this._partitions;
    internal IReadOnlyCollection<long>? SceneFocusMeshIds { get; private set; }
    internal bool Prepared {
        get {
            lock (this._sync) return this.BuiltUtc != default && !this._partitions.Any(p => p.Dirty)
                && this._added.Count + this._modified.Count + this._deleted.Count == 0;
        }
    }

    /// <summary>Mints one epoch per tracker event and queues the ids. No geometry work here.</summary>
    internal void Enqueue(Autodesk.Revit.DB.Events.DocumentChangedEventArgs e) {
        lock (this._sync) {
            this.CurrentEpoch++;
            foreach (var id in e.GetAddedElementIds()) _ = this._added.Add(id.Value());
            foreach (var id in e.GetModifiedElementIds()) _ = this._modified.Add(id.Value());
            foreach (var id in e.GetDeletedElementIds()) _ = this._deleted.Add(id.Value());

            // A link's content cannot change per element, so any event naming its instance or type
            // invalidates that partition whole. It is rebuilt only by an explicit Build.
            foreach (var p in this._partitions) {
                if (p.LinkInstanceId is not { } li) continue;
                if (this._added.Contains(li) || this._modified.Contains(li) || this._deleted.Contains(li))
                    p.Dirty = true;
            }
        }
    }

    internal void BuildAll(Document host) {
        lock (this._sync) {
            this._partitions.Clear();
            this._added.Clear();
            this._modified.Clear();
            this._deleted.Clear();
            this._partitions.Add(new Partition(0, host, SourceKind.Host, null, Transform.Identity));

            var source = 1;
            foreach (var li in new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance))
                         .Cast<RevitLinkInstance>()) {
                var ld = li.GetLinkDocument();
                if (ld is null) continue;
                var kind = ld.Title.IndexOf(".ifc", StringComparison.OrdinalIgnoreCase) >= 0
                    ? SourceKind.IfcLink
                    : SourceKind.RevitLink;
                this._partitions.Add(new Partition(source++, ld, kind, li.Id.Value(), li.GetTotalTransform()));
            }

            foreach (var p in this._partitions) p.Build(this.CurrentEpoch);
            this.BuiltUtc = DateTime.UtcNow;
        }
    }

    internal void BuildScope(Document host, IReadOnlyCollection<long> ids, ref Aabb? crop, double padding, long epoch, bool focusOnly) {
        this.CurrentEpoch = epoch;
        this._partitions.Add(new Partition(0, host, SourceKind.Host, null, Transform.Identity));
        if (focusOnly) {
            this._partitions[0].BuildElements(ids.Select(id => host.GetElement(id.ToElementId())).OfType<Element>(), epoch);
            this.BuiltUtc = DateTime.UtcNow;
            return;
        }
        var source = 1;
        foreach (var link in new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>()) {
            var linked = link.GetLinkDocument();
            if (linked is null) continue;
            var kind = linked.Title.IndexOf(".ifc", StringComparison.OrdinalIgnoreCase) >= 0 ? SourceKind.IfcLink : SourceKind.RevitLink;
            this._partitions.Add(new Partition(source++, linked, kind, link.Id.Value(), link.GetTotalTransform()));
        }
        if (ids.Count > 0) {
            var focus = this._partitions[0];
            focus.BuildElements(ids.Select(id => host.GetElement(id.ToElementId())).OfType<Element>(), epoch);
            this.SceneFocusMeshIds = focus.Prims.Select(row => row.ElementId).ToArray();
            this.ResolveSceneCrop(ids, ref crop, padding);
        }
        if (crop is not { } region) throw new ArgumentException("A contextual scene requires mesh-bearing ids or bounds.");
        foreach (var partition in this._partitions) partition.BuildRegion(region, epoch);
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

    /// <summary>
    ///     Applies whatever the tracker queued, lazily, on the way into a verb. Host only: link
    ///     partitions never patch per element.
    /// </summary>
    internal void ApplyQueued() {
        lock (this._sync) {
            if (this._added.Count == 0 && this._modified.Count == 0 && this._deleted.Count == 0) return;
            var host = this._partitions.FirstOrDefault(p => p.Source == 0);
            host?.Patch(this._added, this._modified, this._deleted, this.CurrentEpoch);
            this._added.Clear();
            this._modified.Clear();
            this._deleted.Clear();
        }
    }

    /// <summary>
    ///     Fresh is false when any touched partition is dirty, when ids are still queued unpatched,
    ///     or when nothing has been built. An unbuilt world answers every question with an empty
    ///     result, and an empty result that calls itself fresh is a lying world.
    /// </summary>
    internal Stamp StampFor(IEnumerable<Partition> touched, Filter filter) {
        lock (this._sync) {
            var seen = touched as IReadOnlyList<Partition> ?? touched.ToList();
            var rows = this._partitions.Select(p => p.Row).ToList();
            var pending = this._added.Count + this._modified.Count + this._deleted.Count > 0;
            var fresh = this._partitions.Count > 0 && !pending && !seen.Any(p => p.Dirty);
            return new Stamp(
                this.HostDocumentKey, this.CurrentEpoch, Stamp.HostInternalFt, this.BuiltUtc, rows, fresh,
                Resolve(seen, filter));
        }
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
