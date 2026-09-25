namespace Pe.Shared.RevitData.Takeoffs;

public sealed record TakeoffRegistrySystem(Guid Guid, string Tag);
public enum TakeoffCarrierStage
{
    Adoption,
    Materialization,
    Rooms,
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
    List<List<double[]>> Loops,
    // Where the region lies against its own view's model crop; null when that view has no active crop. Outside: that
    // view's image can never show it (D4 leg B: project-a zones C-F lie outside the views they are owned by).
    RevitCropCoverage? OwnerCrop);
public sealed record TakeoffLiveRegion(
    long ElementId,
    string Role,
    Guid Guid,
    double Sqft,
    string RoomType,
    string Blob,
    List<double[]> Outer,
    List<List<double[]>> Holes,
    TakeoffRegionAnalysis? Analysis = null);
/// <summary>Freshness against native region and zone geometry, not a claim about all model evidence.</summary>
public sealed record TakeoffRegionAnalysis(
    string State, string? RunId, double? FloorZ, double? CeilingZ, string? Hold);
public sealed record TakeoffSnapshotData(
    TakeoffModelStatus Status,
    IReadOnlyList<TakeoffRegionFacts> ZoneFrs,
    IReadOnlyDictionary<string, List<TakeoffLiveRegion>> RegionsByZone);
public sealed record TakeoffSnapshotResponse(Reading Reading, TakeoffSnapshotData Snapshot);

public sealed record TakeoffCandidatesRequest(string View);
public sealed record TakeoffCandidatesData(IReadOnlyList<TakeoffRegionFacts> Regions);

public sealed record TakeoffAdoptItem(long ElementId, string Name, string SystemTag);
public sealed record TakeoffAdoptRequest(string View, List<TakeoffAdoptItem> Items);
// OwnerCrop: where the adopted region lies against the view's model crop (null: no active crop). Adoption never refuses on it.
public sealed record TakeoffAdopted(long ElementId, Guid Guid, RevitCropCoverage? OwnerCrop);
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
    double ExcludedSqft,
    double VoidSqft,
    double TotalSqft,
    string EnclosureSource,
    string? Hold,
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

public sealed record TakeoffWriteResult(long ElementId, Guid ZoneGuid, int Bytes, string Blob);

public sealed record TakeoffRhvacLink(
    int Identifier,
    string FileIdentity,
    string SyncedAt,
    double LastSyncedSqft);
public sealed record TakeoffRhvacLinkWrite(long ElementId, TakeoffRhvacLink Link);
public sealed record TakeoffRhvacLinksRequest(List<TakeoffRhvacLinkWrite> Writes);
public sealed record TakeoffRhvacLinksData(IReadOnlyList<TakeoffWriteResult> Writes);

// /rooms (docs/features/rooms/LEDGER.md). A zone, room, or held region on a level-scoped plan view; same carriers
// as takeoffs plus the seven room fields. Loops are [x,y] host feet, outer CCW, even-odd holes.
// Role is "zone" | "room" | "held". Zone is the parent zone's guid (null = not in a zone on this view).
// Designation is "person" | "inferred" for hand-drawn regions, null for machine regions.
public sealed record RoomsLevel(string Name, double Elevation, IReadOnlyList<string> Views);
public sealed record RoomsRegion(
    long ElementId,
    Guid Guid,
    string View,
    string Level,
    string Role,
    Guid? Zone,
    string? Designation,
    string Name,
    string Type,
    double? CeilingFt,
    double? People,
    double? LightingW,
    double? EquipSensible,
    double? EquipLatent,
    double? VentilationCfm,
    double Sqft,
    List<double[]> Outer,
    List<List<double[]>> Holes,
    double[] Label,
    string RunId,
    string? Reason,
    bool Touched,
    bool Locked,
    bool Stale);
public sealed record RoomsSnapshotData(IReadOnlyList<RoomsLevel> Levels, IReadOnlyList<RoomsRegion> Regions);

public sealed record RoomsPartitionRequest(string View, string? RunId = null);
public sealed record RoomsPartitionResult(
    string Level,
    string RunId,
    int Zones,
    int Created,
    int Kept,
    int Locked,
    int Deleted,
    int Held,
    IReadOnlyList<string> Failures,
    string? Hold,
    double Ms);

// Role is "room" (default) or "zone".
public sealed record RoomsDrawRequest(string View, List<List<double[]>> Loops, string? Name = null, string? Role = null);
public sealed record RoomsDrawResult(long ElementId, Guid Guid);

public sealed record RoomsWriteRegion(
    Guid Guid,
    string? Name = null,
    string? Type = null,
    double? CeilingFt = null,
    double? People = null,
    double? LightingW = null,
    double? EquipSensible = null,
    double? EquipLatent = null,
    double? VentilationCfm = null,
    string? Role = null);
public sealed record RoomsWriteRequest(List<RoomsWriteRegion> Regions);
public sealed record RoomsWriteResult(int Written);
