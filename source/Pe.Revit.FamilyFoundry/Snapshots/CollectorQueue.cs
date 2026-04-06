using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;

namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Fluent queue that batches collectors for snapshot collection.
/// </summary>
public class CollectorQueue {
    private readonly List<object> _collectors = [];

    /// <summary>
    ///     Gets all collectors in the queue for inspection.
    /// </summary>
    public IReadOnlyList<object> Collectors => this._collectors;

    /// <summary>
    ///     Add a collector to the queue (IFamilyDocCollector or IProjectCollector).
    /// </summary>
    public CollectorQueue Add(object collector) {
        if (collector is not IFamilyDocCollector and not IProjectCollector) {
            throw new ArgumentException(
                "Collector must implement IFamilyDocCollector or IProjectCollector",
                nameof(collector));
        }

        this._collectors.Add(collector);
        return this;
    }

    /// <summary>
    ///     Creates a callback for project-based collection.
    ///     Executes all IProjectCollector collectors that pass ShouldCollect.
    /// </summary>
    public Action<FamilySnapshot, Document, Family> ToProjectCollectorFunc() => (snapshot, projDoc, family) => {
        foreach (var collector in this._collectors) {
            if (collector is IProjectCollector pc && pc.ShouldCollect(snapshot))
                pc.Collect(snapshot, projDoc, family);
        }
    };

    /// <summary>
    ///     Creates a callback for family-doc-based collection.
    ///     Executes all IFamilyDocCollector collectors that pass ShouldCollect.
    /// </summary>
    public Action<FamilySnapshot, FamilyDocument> ToFamilyDocCollectorFunc() => (snapshot, famDoc) => {
        foreach (var collector in this._collectors) {
            if (collector is IFamilyDocCollector fdc && fdc.ShouldCollect(snapshot))
                fdc.Collect(snapshot, famDoc);
        }
    };
}
