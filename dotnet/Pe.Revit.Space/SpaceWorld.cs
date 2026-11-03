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
        documents.Closed += key => {
            lock (Sync) States.Remove(key.Value);
            // An open host can keep a shared link loaded even before its first Space read.
            foreach (var tracked in documents.Open) {
                var host = tracked.Resolve();
                using var links = new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance));
                GeometryLedger.Sources(tracked.Key.Value, links.Cast<RevitLinkInstance>()
                    .Select(link => link.GetLinkDocument()).OfType<Document>().Select(doc => doc.GetDocumentKey()));
            }
            GeometryLedger.Closed(key.Value);
        };
        documents.KeyChanged += (tracked, oldKey) => GeometryLedger.Renamed(oldKey.Value, tracked.Key.Value);
    }

    /// <summary>Explicit whole-model geometry door for scripts and Pods. Cold Chadds costs 220 s and +9.4 GiB;
    /// native geometry remains until document close. Prefer scoped reads for smaller questions.</summary>
    public static World Prepare(Document document) {
        var world = new World(document.GetDocumentKey(), Epoch(document));
        world.BuildAll(document);
        LinkedGeometryStore.Prune();
        return world;
    }

    /// <summary>
    ///     What one question can touch, and nothing more: every source placement loads only the elements whose bounds meet
    ///     <paramref name="reach" /> (host-frame boxes as 8 corners; default the scope itself), through the /ducts context
    ///     read: one quick filter per placement, ids counted before any load, triangle-less classes never loaded. A verb
    ///     asks this world only inside <paramref name="scope" />; a question outside it throws instead of answering CLEAR.
    ///     Every source is planned before geometry acquisition; the stamp reports estimated and retained cost.
    ///     <paramref name="curves" /> reads CAD ribbons: a site DWG's ribbons were 2.6 M of a 10 ft Cleremont Sweep's
    ///     2.75 M triangles, and no default question asks for Curve2D.
    /// </summary>
    public static World Prepare(Document document, Aabb scope, IReadOnlyList<XYZ[]>? reach = null, bool curves = false) {
        var world = new World(document.GetDocumentKey(), Epoch(document), scope, curves);
        world.BuildWithin(document, reach ?? [scope.Corners()]);
        LinkedGeometryStore.Prune();
        return world;
    }

    internal static World SceneSources(Document document) {
        var world = new World(document.GetDocumentKey(), Epoch(document));
        world.InitializeSources(document);
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
    internal GeometryLedger.Read? Acquisition { get; set; }
    public GeometryCost? GeometryCost => this.Acquisition?.Report();

    internal World(string hostKey, long epoch, Aabb? scope = null, bool curves = true) {
        this.HostDocumentKey = hostKey; this.CurrentEpoch = epoch; this.Scope = scope; this.Curves = curves;
    }
    public string HostDocumentKey { get; }
    /// <summary>The host-frame box this world was read for; null when it holds the whole model.</summary>
    public Aabb? Scope { get; }
    /// <summary>Whether CAD imports were read as Curve2D ribbons. A whole-model world always reads them.</summary>
    public bool Curves { get; }
    public long CurrentEpoch { get; private set; }
    public DateTime BuiltUtc { get; private set; }
    internal IReadOnlyList<Partition> Partitions => this._partitions;
    internal Document HostDocument => this._partitions[0].Doc;
    private readonly List<(long LinkInstanceId, string Name, SceneSourceState State, Transform Transform)> _unread = [];
    /// <summary>Link placements with no readable document: unloaded, or unavailable on this machine.</summary>
    internal IReadOnlyList<(long LinkInstanceId, string Name, SceneSourceState State, Transform Transform)> Unread => this._unread;

    internal void InitializeSources(Document host) {
        this._partitions.Add(new Partition(0, host, SourceKind.Host, null, Transform.Identity, SpaceWorld.HostGeneration(host)));
        var links = new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().ToList();
        var generation = SpaceWorld.LinkGeneration(host, links);
        var source = 1;
        foreach (var link in links) {
            var linked = link.GetLinkDocument();
            if (linked is null) {
                // An unread placement is disclosed, never silently dropped (Manuella: every link unloaded).
                var type = host.GetElement(link.GetTypeId()) as RevitLinkType;
                var state = type?.GetLinkedFileStatus() is LinkedFileStatus.Unloaded or LinkedFileStatus.LocallyUnloaded
                    or LinkedFileStatus.InClosedWorkset ? SceneSourceState.Unloaded : SceneSourceState.Unavailable;
                this._unread.Add((link.Id.Value(), type?.Name ?? link.Name, state, link.GetTotalTransform()));
                continue;
            }
            var kind = linked.Title.IndexOf(".ifc", StringComparison.OrdinalIgnoreCase) >= 0 ? SourceKind.IfcLink : SourceKind.RevitLink;
            this._partitions.Add(new Partition(source++, linked, kind, link.Id.Value(), link.GetTotalTransform(), generation));
        }
        // Unsaved tracker keys use the SDK open id, not GetDocumentKey's wrapper hash.
        var ledgerHost = PeDocumentIdentity.TryGetOpenId(host, out var openId)
            ? DocumentKey.For(host, openId).Value : this.HostDocumentKey;
        GeometryLedger.Sources(ledgerHost, this._partitions.Select(p => p.DocumentKey));
        this.BuiltUtc = DateTime.UtcNow;
    }

    internal void BuildAll(Document host) {
        this.InitializeSources(host);
        var plans = this._partitions.Select(p => {
            using var collector = new FilteredElementCollector(p.Doc).WhereElementIsNotElementType();
            return ReachPlan.Empty(p) with { Keep = collector.ToElementIds().ToArray() };
        }).ToList();
        this.Acquisition = new GeometryLedger.Read(plans);
        foreach (var plan in plans) plan.Source.Build(this.CurrentEpoch, plan.Source.Load(plan).Kept);
        this.BuiltUtc = DateTime.UtcNow;
    }

    internal void BuildWithin(Document host, IReadOnlyList<XYZ[]> reach) {
        this.InitializeSources(host);
        var scope = this.Scope!.Value;
        // Plan every source and CAD ribbon reach before geometry acquisition.
        var plans = this._partitions.Select(partition => partition.Plan(reach, scope.Corners(), obstacles: true)).ToList();
        if (this.Curves) plans = plans.Select(plan => plan.Source.WithImports(plan, scope)).ToList();
        this.Acquisition = new GeometryLedger.Read(plans);
        foreach (var plan in plans) {
            var partition = plan.Source;
            partition.Build(this.CurrentEpoch, partition.Load(plan).Kept, this.Curves);
        }
        this.BuiltUtc = DateTime.UtcNow;
    }

    /// <summary>Refuses a question this world was not read for: geometry outside its scope was never loaded.</summary>
    internal void Require(Aabb question, Filter? filter = null) {
        if (this.Scope is { } scope && !scope.Contains(question))
            throw new ArgumentException($"The question {question} lies outside the scope {scope} this Space world was read for.");
        if (!this.Curves && filter?.Kinds?.Contains(PrimKind.Curve2D) == true)
            throw new ArgumentException("This Space world was read without CAD ribbons; prepare one with curves for a Curve2D question.");
    }

    internal Stamp StampFor(IEnumerable<Partition> touched, Filter filter) {
        var seen = touched as IReadOnlyList<Partition> ?? touched.ToList();
        return new Stamp(this.HostDocumentKey, this.CurrentEpoch, Stamp.HostInternalFt, this.BuiltUtc,
            this._partitions.Select(p => p.Row).ToList(), this.BuiltUtc != default, Resolve(seen, filter)) { GeometryCost = this.GeometryCost };
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
