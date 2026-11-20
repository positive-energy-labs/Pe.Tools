using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Revit.Extensions.ProjDocument;
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

    internal static SystemRegistry StageRegistry(Document document)
    {
        var stored = OwnerBlobStore.Read(document, SystemRegistry.Owner);
        return (stored.MayOverwrite ? SystemRegistry.Read(stored).OrThrow() : null) ?? new SystemRegistry();
    }

    public static void WriteRegistry(Document document, SystemRegistry registry) =>
        _ = OwnerBlobStore.Write(document, SystemRegistry.Owner, registry.ToData());

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
        "Pe Rooms roles, fields and provenance keyed by FilledRegion UniqueId.");

    internal Dictionary<string, RegionRow> Regions { get; } = new(StringComparer.Ordinal);

    internal RegionRow? this[string uniqueId] => this.Regions.GetValueOrDefault(uniqueId);

    internal static OwnerValue<RoomsRegionRecord> Read(Document document) =>
        Decode(OwnerBlobStore.Read(document, Owner));

    internal static OwnerValue<RoomsRegionRecord> Decode(OwnerBlobRead stored) => stored.Parse(data =>
    {
        if (data["regions"] is not JObject regions)
            throw new InvalidOperationException("Rooms data needs a regions map");
        var result = new RoomsRegionRecord();
        foreach (var property in regions.Properties())
        {
            var row = property.Value.ToObject<RegionRow>();
            if (row?.Role is not (TakeoffCarriers.RoleZoningRegion or TakeoffCarriers.RoleRoomRegion or TakeoffCarriers.RoleHeldResidue)
                || string.IsNullOrEmpty(row.Provenance.RunId) || row.Provenance.Flags is null)
                throw new InvalidOperationException($"Invalid Rooms row '{property.Name}'");
            result.Regions.Add(property.Name, row);
        }
        return result;
    });

    internal static RoomsRegionRecord Stage(Document document)
    {
        var stored = OwnerBlobStore.Read(document, Owner);
        // The document store owns recovery of envelope refusals on apply.
        return (stored.MayOverwrite ? Decode(stored).OrThrow() : null) ?? new RoomsRegionRecord();
    }

    internal JObject ToData() => TakeoffJson.Object(new { this.Regions });

    internal void Save(Document document)
    {
        foreach (var (id, row) in this.Regions.Where(pair => pair.Value.Provenance.Partition != null).ToList())
        {
            var provenance = row.Provenance;
            var digest = RoomsRunTraces.KeepOriginal(RoomsRunTraces.Root, document.GetDocumentKey(), provenance.Partition!);
            var hash = provenance.GeometryHash ?? Rooms.GeometryHash(TakeoffAtlas.Boundaries((FilledRegion)document.GetElement(id)));
            this.Regions[id] = row with { Provenance = provenance with
            {
                Partition = null, OriginalTrace = digest, GeometryHash = hash,
            } };
        }
        _ = OwnerBlobStore.Write(document, Owner, this.ToData());
    }

    internal static RegionProvenance ProjectOriginal(Document document, RegionProvenance provenance) =>
        provenance.OriginalTrace is { } digest
            ? provenance with { Partition = RoomsRunTraces.ReadOriginal(RoomsRunTraces.Root, document.GetDocumentKey(), digest) }
            : provenance;
}
