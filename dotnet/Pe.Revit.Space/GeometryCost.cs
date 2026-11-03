namespace Pe.Revit.Space;

internal sealed record TessellatedElement(string DocumentKey, long Epoch, long ElementId);
public sealed record GeometrySourceCost(string Source, long? LinkInstanceId, int Count, int LoadOnlyCount, double Cost);
/// <summary>Acquisition evidence, not a memory cap. Native geometry remains allocated until document close.</summary>
public sealed record GeometryCost(int PlannedCount, double PlannedCost, IReadOnlyList<GeometrySourceCost> PerSource,
    int NewlyTessellatedCount, int CumulativeTessellatedCount);
// ponytail: counts, not ids - a detailed SA 7 read touches ~56k elements, several MiB past the 2 MiB Readings frame cap.

internal static class GeometryLedger {
    private static readonly Dictionary<string, HashSet<TessellatedElement>> Retained = new();
    private static readonly Dictionary<string, HashSet<string>> SourcesByHost = new();
    private static readonly object Sync = new();
    internal static void Sources(string host, IEnumerable<string> sources) {
        lock (Sync) {
            if (!SourcesByHost.TryGetValue(host, out var keys)) SourcesByHost[host] = keys = [];
            keys.UnionWith(sources);
        }
    }
    internal static void Closed(string key) {
        lock (Sync) {
            // The tracker excludes linked documents; their ids live until the last host releases them.
            SourcesByHost.Remove(key, out var sources);
            foreach (var source in (sources ?? []).Append(key))
                if (!SourcesByHost.Values.Any(keys => keys.Contains(source))) Retained.Remove(source);
        }
    }
    internal static void Renamed(string oldKey, string newKey) {
        lock (Sync) {
            if (SourcesByHost.Remove(oldKey, out var sources)) Sources(newKey, sources);
        }
    }
    internal static void Touch(Element element) {
        var key = element.Document.GetDocumentKey();
        var entry = new TessellatedElement(key, SpaceWorld.Epoch(element.Document), element.Id.Value());
        lock (Sync) {
            if (!Retained.TryGetValue(key, out var ids)) Retained[key] = ids = [];
            ids.Add(entry);
        }
    }
    internal static HashSet<TessellatedElement> Snapshot(IEnumerable<string> documents) {
        lock (Sync) return documents.Distinct().SelectMany(key => Retained.TryGetValue(key, out var ids) ? ids : []).ToHashSet();
    }
    // Unknown/modified/nested families and curved runs retain full estimated cost: proving their
    // fallback needs geometry. A class filter alone does not justify a discount.
    internal sealed class Read(IReadOnlyList<ReachPlan> plans, bool overview = false) {
        private readonly HashSet<TessellatedElement> _before = Snapshot(plans.Select(p => p.Source.DocumentKey));
        internal GeometryCost Report() {
            var after = Snapshot(plans.Select(p => p.Source.DocumentKey));
            var sources = plans.Select(p => new GeometrySourceCost(p.Source.Doc.Title, p.Source.LinkInstanceId,
                p.Keep.Count, overview ? p.Keep.Count : 0, overview ? 0 : p.Keep.Count)).ToArray();
            return new GeometryCost(sources.Sum(p => p.Count), sources.Sum(p => p.Cost), sources,
                after.Except(this._before).Count(), after.Count);
        }
    }
}
