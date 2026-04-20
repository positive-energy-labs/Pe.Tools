using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Fluent queue that batches collectors for snapshot collection.
/// </summary>
public class SnapshotCapturePipeline {
    private readonly List<object> _collectors = [];

    /// <summary>
    ///     Gets all collectors in the queue for inspection.
    /// </summary>
    public IReadOnlyList<object> Collectors => this._collectors;

    /// <summary>
    ///     Add a collector to the queue (IFamilySnapshotCollector or IProjectSnapshotCollector).
    /// </summary>
    public SnapshotCapturePipeline Add(object collector) {
        if (collector is not IFamilySnapshotCollector and not IProjectSnapshotCollector) {
            throw new ArgumentException(
                "Collector must implement IFamilySnapshotCollector or IProjectSnapshotCollector",
                nameof(collector));
        }

        this._collectors.Add(collector);
        return this;
    }

    /// <summary>
    ///     Creates a callback for project-based collection.
    ///     Executes all IProjectSnapshotCollector collectors that pass ShouldCollect.
    /// </summary>
    public Action<FamilySnapshot, Document, Family> ToProjectCollectorFunc() => (snapshot, projDoc, family) => {
        foreach (var collector in this._collectors) {
            if (collector is IProjectSnapshotCollector pc && pc.ShouldCollect(snapshot))
                pc.Collect(snapshot, projDoc, family);
        }
    };

    /// <summary>
    ///     Creates a callback for family-doc-based collection.
    ///     Executes all IFamilySnapshotCollector collectors that pass ShouldCollect.
    /// </summary>
    public Action<FamilySnapshot, FamilyDocument> ToFamilyDocCollectorFunc() => (snapshot, famDoc) => {
        foreach (var collector in this._collectors) {
            if (collector is IFamilySnapshotCollector fdc && fdc.ShouldCollect(snapshot))
                fdc.Collect(snapshot, famDoc);
        }
    };
}