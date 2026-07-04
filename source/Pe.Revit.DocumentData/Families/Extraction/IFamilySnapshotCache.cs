using Pe.Shared.RevitData.Families;

namespace Pe.Revit.DocumentData.Families.Extraction;

/// <summary>
///     Cache seam for extracted family-doc truth. Implementations own invalidation; collectors just
///     consult before extracting and store afterwards. Partial records are never cached.
/// </summary>
public interface IFamilySnapshotCache {
    bool TryGet(long familyId, out FamilySnapshotRecord record);

    void Store(FamilySnapshotRecord record);
}
