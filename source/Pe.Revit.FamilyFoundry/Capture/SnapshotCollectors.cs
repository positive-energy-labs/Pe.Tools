using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Strategy interface for collecting snapshot data from a family document.
///     Use for data that can ONLY be collected from family document (e.g., reference planes).
/// </summary>
public interface IFamilySnapshotCollector {
    /// <summary>
    ///     Should this collector run given the current snapshot state?
    ///     Returns false when the relevant snapshot field is already populated, etc.
    /// </summary>
    bool ShouldCollect(FamilySnapshot snapshot);

    /// <summary>
    ///     Execute collection from family document into the snapshot.
    ///     Assumes ShouldCollect returned true.
    /// </summary>
    void Collect(FamilySnapshot snapshot, FamilyDocument famDoc);
}

/// <summary>
///     Strategy interface for collecting snapshot data from a project document.
///     Use for data that can be collected from project (e.g., parameters via temp instances).
/// </summary>
public interface IProjectSnapshotCollector {
    /// <summary>
    ///     Should this collector run given the current snapshot state?
    ///     Returns false when the relevant snapshot field is already populated, etc.
    /// </summary>
    bool ShouldCollect(FamilySnapshot snapshot);

    /// <summary>
    ///     Execute collection from project document into the snapshot.
    ///     Assumes ShouldCollect returned true.
    /// </summary>
    void Collect(FamilySnapshot snapshot, Document projectDoc, Family family);
}
