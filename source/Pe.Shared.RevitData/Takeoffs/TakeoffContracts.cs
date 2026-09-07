namespace Pe.Shared.RevitData.Takeoffs;

public sealed record TakeoffRegistrySystem(Guid Guid, string Tag);
public enum TakeoffCarrierStage
{
    Adoption,
    Materialization,
}
public sealed record TakeoffCarrierPreflight(
    TakeoffCarrierStage Stage,
    string Status,
    IReadOnlyList<Guid> MissingCarrierGuids);
public sealed record TakeoffCarrierInitializationRequest(TakeoffCarrierStage Stage = TakeoffCarrierStage.Adoption);
public sealed record TakeoffCarrierInitializationData(
    string Status,
    Guid? Bound,
    IReadOnlyList<Guid> Remaining);
public sealed record TakeoffModelStatus(
    IReadOnlyList<TakeoffRegistrySystem> Systems,
    TakeoffCarrierPreflight Carriers);
public sealed record TakeoffRegionFacts(
    long ElementId,
    string TypeName,
    string View,
    string Color,
    double Sqft,
    string? Role,
    Guid? Guid,
    string Blob,
    List<List<double[]>> Loops);
public sealed record TakeoffLiveRegion(
    long ElementId,
    string Role,
    Guid Guid,
    double Sqft,
    string RoomType,
    string Blob,
    List<double[]> Outer,
    List<List<double[]>> Holes);
public sealed record TakeoffSnapshotData(
    TakeoffModelStatus Status,
    IReadOnlyList<TakeoffRegionFacts> ZoneFrs,
    IReadOnlyDictionary<string, List<TakeoffLiveRegion>> RegionsByZone);
public sealed record TakeoffSnapshotResponse(Reading Reading, TakeoffSnapshotData Snapshot);

public sealed record TakeoffCandidatesRequest(string View);
public sealed record TakeoffCandidatesData(IReadOnlyList<TakeoffRegionFacts> Regions);

public sealed record TakeoffAdoptItem(long ElementId, string Name, string SystemTag);
public sealed record TakeoffAdoptRequest(string View, List<TakeoffAdoptItem> Items);
public sealed record TakeoffAdopted(long ElementId, Guid Guid);
public sealed record TakeoffAdoptResult(IReadOnlyList<TakeoffAdopted> Adopted);


// The partition runs on Pe.Revit.Space, not on rendered pixels (ADR 0011). The zone region element
// carries its own loop and level, so the replay path, the level fragment and the loops are gone.
public sealed record TakeoffPartitionRequest(
    long ZoneRegion,
    string View,
    string ZoneName,
    Guid ZoneGuid,
    string RunId);
public sealed record TakeoffDetectedRoom(
    string Id,
    double RawSqft,
    double PerimeterFt,
    double MeanCeilingFt,
    double[] Label,
    IReadOnlyList<string> Flags,
    List<double[]> Outer);
public sealed record TakeoffDetectedResidue(
    string Id,
    string Reason,
    double RawSqft,
    double[] Label,
    List<double[]> Outer);
public sealed record TakeoffPromotionFacts(int Accepted, int Held, bool Strict);
public sealed record TakeoffPartitionResult(
    string LevelName,
    double Elevation,
    int Created,
    int Held,
    int Rebound,
    int Orphaned,
    TakeoffPromotionFacts Promotion,
    double DomainSqft,
    double ClaimedWallSqft,
    double ExcludedResidueSqft,
    double TotalSqft,
    string Profile,
    IReadOnlyList<string> Failures,
    IReadOnlyList<TakeoffDetectedRoom> Rooms,
    IReadOnlyList<TakeoffDetectedResidue> Residues,
    IReadOnlyList<TakeoffLiveRegion> Regions,
    TakeoffPartitionReview? Review = null);

public sealed record TakeoffPartitionReview(
    TakeoffReviewSource Source,
    TakeoffReviewZone Zone,
    IReadOnlyList<TakeoffReviewShape> Shapes);
public sealed record TakeoffReviewSource(string RunId, string DocumentKey, string ScopeKey);
public sealed record TakeoffReviewZone(string Key, string Name, IReadOnlyList<IReadOnlyList<double[]>> Loops);
public sealed record TakeoffReviewShape(
    string Id, string Kind, string? Disposition, string? Reason, double? Sqft,
    double[]? Label, IReadOnlyList<IReadOnlyList<double[]>> Loops);

public sealed record TakeoffResolution(
    string Subject,
    string Flag,
    string Verb,
    string At,
    string RunId);
public sealed record TakeoffDecisionsRequest(long ElementId, List<TakeoffResolution> Resolutions);
public sealed record TakeoffWriteResult(long ElementId, Guid ZoneGuid, int Bytes, string Blob);

public sealed record TakeoffRhvacLink(
    int Identifier,
    string FileIdentity,
    string SyncedAt,
    double LastSyncedSqft);
public sealed record TakeoffRhvacLinkWrite(long ElementId, TakeoffRhvacLink Link);
public sealed record TakeoffRhvacLinksRequest(List<TakeoffRhvacLinkWrite> Writes);
public sealed record TakeoffRhvacLinksData(IReadOnlyList<TakeoffWriteResult> Writes);

public sealed record TakeoffRoomTypeRequest(long ElementId, string RoomType);
public sealed record TakeoffRoomTypeData(string RoomType);
