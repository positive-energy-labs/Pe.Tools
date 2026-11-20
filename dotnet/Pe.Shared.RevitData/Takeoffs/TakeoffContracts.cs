using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.RevitData.Takeoffs;

public sealed record TakeoffRegistrySystem(Guid Guid, string Tag);
public sealed record TakeoffModelStatus(IReadOnlyList<TakeoffRegistrySystem> Systems);
public sealed record TakeoffRegionFacts(
    long ElementId,
    string TypeName,
    // The owner view: View is its name for display, ViewUniqueId its identity.
    string View,
    string ViewUniqueId,
    string Color,
    double Sqft,
    string? Role,
    string UniqueId,
    // Empty when the region holds none, and when Unreadable says the stored blob can't be read (it is kept).
    string Blob,
    List<List<double[]>> Loops,
    // Where the region lies against its own view's model crop; null when that view has no active crop. Outside: that
    // view's image can never show it (D4 leg B: project-a zones C-F lie outside the views they are owned by).
    RevitCropCoverage? OwnerCrop,
    string? Unreadable = null);
public sealed record TakeoffLiveRegion(
    long ElementId,
    string Role,
    string UniqueId,
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
    IReadOnlyDictionary<string, List<TakeoffLiveRegion>> RegionsByZone,
    IReadOnlyList<TakeoffUnreadableBlob>? Unreadable = null);

/// <summary>
///     A model record the listing cannot read. Document records report a null ElementId.
/// </summary>
public sealed record TakeoffUnreadableBlob(long? ElementId, string Parameter, string Reason);
public sealed record TakeoffSnapshotResponse(Reading Reading, TakeoffSnapshotData Snapshot);

// View is a plan view UniqueId everywhere a request names a plan; a name never selects one.
public sealed record TakeoffCandidatesRequest(string View);
public sealed record TakeoffCandidatesData(IReadOnlyList<TakeoffRegionFacts> Regions);

public sealed record TakeoffAdoptItem(long ElementId, string UniqueId, string Name, string SystemTag);
public sealed record TakeoffRecordReplacements(OwnerBlobReplacement? Regions, OwnerBlobReplacement? Registry);
public sealed record TakeoffAdoptRequest(string View, List<TakeoffAdoptItem> Items,
    OwnerBlobReplacement? Replacing = null, OwnerBlobReplacement? ReplacingRegistry = null);
// OwnerCrop: where the adopted region lies against the view's model crop (null: no active crop). Adoption never refuses on it.
public sealed record TakeoffAdopted(long ElementId, string UniqueId, RevitCropCoverage? OwnerCrop);
public sealed record TakeoffAdoptResult(IReadOnlyList<TakeoffAdopted> Adopted);


// The partition runs on Pe.Revit.Space, not on rendered pixels (ADR 0011). The zone region element
// carries its own loop and level, so the replay path, the level fragment and the loops are gone.
public sealed record TakeoffPartitionRequest(
    long ZoneRegion,
    string View,
    string ZoneName,
    string ZoneUniqueId,
    string RunId,
    OwnerBlobReplacement? Replacing = null);
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

public sealed record TakeoffWriteResult(long ElementId, string UniqueId, string? ZoneUniqueId, int Bytes, string Blob);

public sealed record TakeoffRhvacLink(
    int Identifier,
    string FileIdentity,
    string SyncedAt,
    double LastSyncedSqft);
public sealed record TakeoffRhvacLinkWrite(long ElementId, string UniqueId, TakeoffRhvacLink Link);
public sealed record TakeoffRhvacLinksRequest(List<TakeoffRhvacLinkWrite> Writes, OwnerBlobReplacement? Replacing = null);
public sealed record TakeoffRhvacLinksData(IReadOnlyList<TakeoffWriteResult> Writes);

// /rooms (docs/features/rooms/LEDGER.md). A zone, room, or held region on a level-scoped plan view; record shared
// with Takeoffs. Loops are [x,y] host feet, outer CCW, even-odd holes.
// Role is "zone" | "room" | "held". Zone is the parent zone's UniqueId (null = not in a zone on this view).
// Designation is "person" | "inferred" for hand-drawn regions, null for machine regions.
public sealed record RoomsPlanView(string UniqueId, string Name, string Type);
public sealed record RoomsLevel(string Name, double Elevation, IReadOnlyList<RoomsPlanView> Views);
public sealed record RoomsRegion(
    long ElementId,
    string UniqueId,
    string View,
    string Level,
    string Role,
    string? Zone,
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
    bool Stale,
    IReadOnlyList<string>? MergedFrom = null);
public sealed record RoomsSnapshotData(IReadOnlyList<RoomsLevel> Levels, IReadOnlyList<RoomsRegion> Regions,
    IReadOnlyList<TakeoffUnreadableBlob>? Unreadable = null, IReadOnlyList<string>? TrackedRegionIds = null);

// Rejected: a person's standing "not a room" marks, each an outer ring of x y points in model feet on the view. A face
// overlapping one at IoU 0.6 or more is held as rejected instead of becoming a room.
public sealed record RoomsPartitionRequest(string View, string? RunId = null, IReadOnlyList<double[][]>? Rejected = null,
    OwnerBlobReplacement? Replacing = null);
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
public sealed record RoomsDrawRequest(string View, List<List<double[]>> Loops, string? Name = null, string? Role = null,
    OwnerBlobReplacement? Replacing = null);
public sealed record RoomsDrawResult(long ElementId, string UniqueId);

public sealed record RoomsWriteRegion(
    [property: RegularExpression("^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{8}$")] string UniqueId,
    string? Name = null,
    string? Type = null,
    double? CeilingFt = null,
    double? People = null,
    double? LightingW = null,
    double? EquipSensible = null,
    double? EquipLatent = null,
    double? VentilationCfm = null,
    string? Role = null);
public sealed record RoomsWriteRequest(List<RoomsWriteRegion> Regions, OwnerBlobReplacement? Replacing = null);
public enum RoomField { name, type, ceilingFt, people, lightingW, equipSensible, equipLatent, ventilationCfm, role }
public sealed record RoomsWriteCell(string UniqueId, RoomField Field,
    [property: JsonProperty(Required = Required.AllowNull, NullValueHandling = NullValueHandling.Include)] object? Value);
public sealed record RoomsWriteReceipt(IReadOnlyList<RoomsWriteCell> Cells);

// Combine two or more rooms or held regions of one zone on one view into one locked Room Region; the sources are deleted.
public sealed record RoomsMergeRequest(string View, List<string> UniqueIds, string? Name = null,
    OwnerBlobReplacement? Replacing = null);
public sealed record RoomsMergeResult(long ElementId, string UniqueId, IReadOnlyList<string> MergedFrom, double Sqft);

// The solver's layer 1 per zone, as rooms.partition persisted it (<state>/rooms/<runId>/<zoneUniqueId>.json). The wire
// mirror of Pe.Revit.Partition's Trace and Accounting, read back by name; Pe.Partition.Tests holds the round trip.
// Points are [x,y] host feet. Face Index is the partition answer's Room.Index, not a region UniqueId.
public enum RoomsSegKind { Wall, Zone, Closed, Door, Headed, Cased }
public enum RoomsFaceKind { Room, Contested, Band }
public sealed record RoomsTraceRail(double[] A, double[] B, double ThicknessFt, string Source, long ElementId, string Category, string? Layer);
public sealed record RoomsTraceSegment(double[] A, double[] B, RoomsSegKind Kind);
public sealed record RoomsTraceOpening(double[] A, double[] B, double WidthFt, RoomsSegKind Kind, int DoorPieces, double HeaderFraction, double WallFraction);
public sealed record RoomsTraceFace(int Index, RoomsFaceKind Kind, double? BandWidthFt, bool OwnEdgeEmpty, double? FloatingFt, bool Narrow, double Backed);
public sealed record RoomsTrace(
    IReadOnlyList<RoomsTraceRail> Rails,
    IReadOnlyList<RoomsTraceSegment> Segments,
    IReadOnlyList<RoomsTraceOpening> Openings,
    IReadOnlyList<RoomsTraceFace> Faces);
public sealed record RoomsTraceAccounting(double ZoneSqft, double Accepted, double Held, double Void, double Excluded);
public sealed record RoomsZoneTrace(string ZoneUniqueId, string Label, RoomsTrace Trace, RoomsTraceAccounting Accounting);

// RunId null reads the view's latest committed partition run.
public sealed record RoomsTraceRequest(string View, string? RunId = null);
public sealed record RoomsTraceData(string RunId, IReadOnlyList<RoomsZoneTrace> Zones,
    string? OriginalIssue = null, IReadOnlyList<string>? MissingOriginals = null);

/// <summary>Geometry scope. Empty scope reads only the geometry-free roster.</summary>
public sealed record TakeoffReadRequest(IReadOnlyList<string>? Views = null, IReadOnlyList<string>? ZoneUniqueIds = null);
public sealed record RoomsReadRequest(string View);
