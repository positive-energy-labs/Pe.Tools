namespace Pe.Shared.RevitData.Takeoffs;

public sealed record TakeoffReadingFrom(
    string Target,
    string DocumentId,
    string? DocumentVersionToken,
    string ObservedAt);

public sealed record TakeoffViewFacts(string Name, string Level, int Regions);
public sealed record TakeoffViewsData(IReadOnlyList<TakeoffViewFacts> Views);
public sealed record TakeoffRegistrySystem(Guid Guid, string Tag);
public sealed record TakeoffRegionCount(Guid ZoneGuid, int Rooms, int Held);
public sealed record TakeoffModelStatus(
    string Doc,
    IReadOnlyList<TakeoffRegistrySystem> Systems,
    IReadOnlyList<TakeoffRegionCount> Regions);
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
    List<double[]> Outer);
public sealed record TakeoffSnapshotData(
    TakeoffModelStatus Status,
    IReadOnlyList<TakeoffViewFacts> Views,
    IReadOnlyList<TakeoffRegionFacts> ZoneFrs,
    IReadOnlyDictionary<string, List<TakeoffLiveRegion>> RegionsByZone);
public sealed record TakeoffSnapshotResponse(TakeoffReadingFrom From, TakeoffSnapshotData Snapshot);

public sealed record TakeoffCandidatesRequest(string View);
public sealed record TakeoffCandidatesData(IReadOnlyList<TakeoffRegionFacts> Regions);

public sealed record TakeoffAdoptItem(long ElementId, string Name, string SystemTag);
public sealed record TakeoffAdoptRequest(string View, List<TakeoffAdoptItem> Items);
public sealed record TakeoffAdopted(long ElementId, Guid Guid);
public sealed record TakeoffAdoptResult(IReadOnlyList<TakeoffAdopted> Adopted);

public sealed record TakeoffPrepareCaptureRequest(string View);
public sealed record TakeoffCapturePrepared(string Level);
public sealed record TakeoffDetectCaptureRequest(string Level);
public sealed record TakeoffCaptureResult(
    string Level,
    string ReplayPath,
    int Rooms,
    double TotalSqft);

public sealed record TakeoffPartitionRequest(
    string ReplayPath,
    string View,
    string LevelFragment,
    string ZoneName,
    Guid ZoneGuid,
    string RunId,
    List<List<double[]>> Loops);
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
    IReadOnlyList<TakeoffLiveRegion> Regions);

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
