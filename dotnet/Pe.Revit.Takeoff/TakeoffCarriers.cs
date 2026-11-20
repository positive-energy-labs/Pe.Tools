using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Takeoff;

public static class TakeoffCarriers
{
    public const string RoleZoningRegion = "zoning-region";
    public const string RoleRoomRegion = "room-region";
    public const string RoleHeldResidue = "held-residue";

    public static TakeoffCarrierPreflight Preflight(
        Document document,
        TakeoffCarrierStage stage = TakeoffCarrierStage.Adoption)
    {
        var missing = document.ProjectInformation?.get_Parameter(SystemRegistry.Owner.Guid) == null
            ? new[] { SystemRegistry.Owner.Guid } : [];
        return new(stage, missing.Length == 0 ? "ready" : "needs-initialization", missing);
    }

    public static TakeoffCarrierInitializationData InitializeNext(Document document, TakeoffCarrierStage stage)
    {
        if (Preflight(document, stage).MissingCarrierGuids.Count == 0)
            return new("ready", null, []);

        SharedParameterBinder.EnsureProjectBinding(
            document, OwnerBlobStore.Spec(SystemRegistry.Owner), [BuiltInCategory.OST_ProjectInformation]);
        Pe.Revit.Partition.EnclosureDeclaration.EnsureBound(document);
        document.Regenerate();
        var remaining = Preflight(document, stage);
        return new(remaining.Status, SystemRegistry.Owner.Guid, remaining.MissingCarrierGuids);
    }

    public static OwnerValue<SystemRegistry> TryReadRegistry(Document document) =>
        SystemRegistry.Read(OwnerBlobStore.Read(document, SystemRegistry.Owner));

    public static SystemRegistry ReadRegistry(Document document) => TryReadRegistry(document).OrThrow() ?? new SystemRegistry();

    public static TakeoffRecordReplacements Replacements(Document document) => new(
        OwnerBlobStore.Read(document, RoomsRegionRecord.Owner).Replacement,
        OwnerBlobStore.Read(document, SystemRegistry.Owner).Replacement);

    internal static SystemRegistry StageRegistry(Document document, OwnerBlobReplacement? replacing)
    {
        var stored = OwnerBlobStore.Read(document, SystemRegistry.Owner);
        var registry = SystemRegistry.Read(stored).Value ?? new SystemRegistry();
        CheckReplacement(stored, registry.ToData(), replacing);
        return registry;
    }

    internal static void CheckReplacement(OwnerBlobRead stored, JObject data, OwnerBlobReplacement? replacing)
    {
        if (stored.Replacement != null || replacing != null)
            _ = OwnerBlob.Replace(stored, data, (_, _) => { }, replacing);
    }

    internal static void Save(Document document, OwnerDescriptor owner, JObject data, OwnerBlobReplacement? replacing, OwnerBlobNotices? notices)
    {
        if (replacing is null) _ = OwnerBlobStore.Write(document, owner, data);
        else _ = OwnerBlobStore.Write(document, owner, data, replacing, notices ?? throw new ArgumentNullException(nameof(notices)));
    }

}

public sealed record RoomFields(
    string? Name = null,
    string? Type = null,
    double? CeilingFt = null,
    double? People = null,
    double? LightingW = null,
    double? EquipSensible = null,
    double? EquipLatent = null,
    double? VentilationCfm = null);

internal sealed record RegionRow(
    [property: JsonProperty(Required = Required.Always)] string Role,
    [property: JsonProperty(Required = Required.Always)] RoomFields Fields,
    [property: JsonProperty(Required = Required.Always)] RegionProvenance Provenance);

/// <summary>The document's Rooms rows, staged in memory by the caller that owns the transaction.</summary>
public sealed class RoomsRegionRecord
{
    public static readonly OwnerDescriptor Owner = new("rooms-regions", 1,
        new Guid("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9020"), "_PE_RoomsRegions",
        "Pe Rooms roles, fields and provenance keyed by FilledRegion UniqueId.",
        static read => Decode(read).Refusal);

    internal string? Refusal { get; private set; }
    internal string? Recovery => RecoveryFor(this.Refusal);
    internal static string? RecoveryFor(string? refusal) => refusal is { } reason
        ? $"{reason}. Preview and apply rooms.draw, rooms.partition, or takeoffs.adopt to recover it." : null;
    internal Dictionary<string, RoomsTraceRun> Runs { get; private init; } = new(StringComparer.Ordinal);

    internal string TraceId { get; private init; } = Guid.NewGuid().ToString("N");

    internal Dictionary<string, RegionRow> Regions { get; } = new(StringComparer.Ordinal);

    internal RegionRow? this[string uniqueId] => this.Regions.GetValueOrDefault(uniqueId);

    internal static OwnerValue<RoomsRegionRecord> Read(Document document) =>
        Decode(OwnerBlobStore.Read(document, Owner));

    internal static OwnerValue<RoomsRegionRecord> Decode(OwnerBlobRead stored) => stored.Parse(data =>
    {
        if (data["regions"] is not JObject regions)
            throw new InvalidOperationException("Rooms data needs a regions map");
        var traceId = data["traceId"] is JValue { Type: JTokenType.String } value ? (string?)value : null;
        if (!Guid.TryParseExact(traceId, "N", out var id) || id == Guid.Empty)
            throw new InvalidOperationException("Rooms data needs a stable trace id");
        var result = new RoomsRegionRecord { TraceId = traceId!,
            Runs = data["runs"]?.ToObject<Dictionary<string, RoomsTraceRun>>() ?? new(StringComparer.Ordinal) };
        if (result.Runs.Any(pair => pair.Value is not { RunId.Length: > 0, Zones: >= 0 } run
            || run.View != pair.Key || !Guid.TryParseExact(run.Attempt, "N", out _)))
            throw new InvalidOperationException("Invalid Rooms view run reference");
        foreach (var property in regions.Properties())
        {
            var row = property.Value.ToObject<RegionRow>();
            if (row?.Role is not (TakeoffCarriers.RoleZoningRegion or TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue)
                || string.IsNullOrWhiteSpace(row.Provenance.RunId) || row.Provenance.Flags is null)
                throw new InvalidOperationException($"Invalid Rooms row '{property.Name}'");
            result.Regions.Add(property.Name, row);
        }
        return result;
    });

    internal static RoomsRegionRecord Stage(Document document, OwnerBlobReplacement? replacing = null)
    {
        var record = Stage(OwnerBlobStore.Read(document, Owner), replacing);
        record.Prune(document);
        return record;
    }

    internal static RoomsRegionRecord Stage(OwnerBlobRead stored, OwnerBlobReplacement? replacing)
    {
        var read = Decode(stored);
        var record = read.Value ?? new RoomsRegionRecord { Refusal = read.Refusal };
        if (record.Recovery != null && replacing == null)
            throw new InvalidOperationException($"Preview before replacing '{Owner.Name}': {record.Recovery}");
        if (replacing != null)
            TakeoffCarriers.CheckReplacement(stored, record.ToData(), replacing);
        return record;
    }

    internal bool RecordSolvedRun(RoomsTraceRun run)
    {
        if (run.Zones == 0) return false;
        this.Runs[run.View] = run;
        return true;
    }

    private void Prune(Document document)
    {
        this.Prune(id => document.GetElement(id) is FilledRegion);
        foreach (var id in this.Runs.Keys.Where(id => document.GetElement(id) is not ViewPlan view
            || new FilteredElementCollector(document).OfClass(typeof(FilledRegion))
                .WherePasses(new ElementOwnerViewFilter(view.Id)).FirstElementId() == ElementId.InvalidElementId).ToList())
            this.Runs.Remove(id);
    }

    internal void Prune(Func<string, bool> isFilledRegion)
    {
        foreach (var id in this.Regions.Keys.Where(id => !isFilledRegion(id)).ToList())
            this.Regions.Remove(id);
    }

    internal JObject ToData() => TakeoffJson.Object(new { this.TraceId, this.Regions, this.Runs });

    // Project future rows with a conservative UniqueId length and the archived form they actually store.
    internal T BeforeMutation<T>(Func<T> begin, IEnumerable<RegionRow>? additions = null)
    {
        var data = this.ToData();
        var regions = (JObject)data["regions"]!;
        int index = 0;
        foreach (var (id, row) in this.Regions.Where(pair => pair.Value.Provenance.Partition != null))
            regions[id] = TakeoffJson.Object(Archive(row));
        foreach (var row in additions ?? [])
            regions[(++index).ToString("D64")] = TakeoffJson.Object(Archive(row));
        _ = OwnerBlob.Encode(Owner, data);
        return begin();
    }

    internal static readonly string PendingHash = new('0', 64);

    private static RegionRow Archive(RegionRow row, string? digest = null, string? geometryHash = null) =>
        row.Provenance.Partition == null ? row : row with { Provenance = row.Provenance with
        {
            Partition = null, OriginalTrace = digest ?? PendingHash,
            GeometryHash = row.Provenance.GeometryHash ?? geometryHash ?? PendingHash,
        } };

    internal void Save(Document document, string? traceRoot = null, OwnerBlobReplacement? replacing = null, OwnerBlobNotices? notices = null)
    {
        this.Prune(document);
        var originals = new List<string>();
        foreach (var (id, row) in this.Regions.Where(pair => pair.Value.Provenance.Partition != null).ToList())
        {
            var json = TakeoffJson.Serialize(row.Provenance.Partition!);
            originals.Add(json);
            var hash = row.Provenance.GeometryHash ?? Rooms.GeometryHash(TakeoffAtlas.Boundaries((FilledRegion)document.GetElement(id)));
            this.Regions[id] = Archive(row, RoomsRunTraces.Hash(json), hash);
        }
        this.BeforeMutation(() => true);
        foreach (var json in originals)
            RoomsRunTraces.KeepOriginal(traceRoot ?? RoomsRunTraces.Root, this.TraceId, json);
        TakeoffCarriers.Save(document, Owner, this.ToData(), replacing, notices);
    }

    internal RegionProvenance ProjectOriginal(RegionProvenance provenance, string? traceRoot = null) =>
        provenance.OriginalTrace is { } digest
            ? provenance with { Partition = RoomsRunTraces.ReadOriginal(traceRoot ?? RoomsRunTraces.Root, this.TraceId, digest) }
            : provenance;
}
