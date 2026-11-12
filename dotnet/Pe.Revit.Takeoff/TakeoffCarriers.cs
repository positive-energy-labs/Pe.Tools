using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Takeoff;

// The one place that spells takeoff's persistence homes (README data-homes table). Everything
// above speaks FRs and the registry only through this module — nobody else touches a Parameter.
// Both blobs (the per-region provenance and the System registry) are owner envelopes written through
// OwnerBlobStore: the region blob on its element, the registry on Project Information. Extensible
// storage is banned; the one exception in the repo is the duct per-fitting results entity, which
// Revit's pressure-drop server API requires (ADR 0032 storage amendment, rule 7).
//
// FOOTGUN: OST_FilledRegion.AllowsBoundParameters == false, but a shared param instance-bound to
// Detail Items IS writable on FR instances — that indirection is the only reason this module works.
// Live-proven 2026-08-14 on the project-a clone (Revit 2025): a text param bound through our own
// SharedParameterBinder landed on all 9,212 FilledRegions, set + Regenerate round-tripped
// in-transaction, and read back identically from a separate later call. Evidence:
// docs/features/takeoffs/LEDGER.md 2026-08-14 (live Revit); the .r10 side is proven in
// .private/fixtures/project-a/rhvac/UPSERT-PROBE.md. Residual: survival across save/sync/reopen is untested.
public static class TakeoffCarriers
{
    // Stable carrier identities. Changing any of these orphans deployed models — never reuse.
    internal static readonly Guid RoleGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001");
    internal static readonly Guid RegionGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9002");
    // The per-region blob's descriptor is RegionProvenance.Owner; the registry's is SystemRegistry.Owner.
    internal static OwnerDescriptor Provenance => RegionProvenance.Owner;
    internal static readonly Guid RoomTypeGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9005");

    internal static readonly Guid RoomNameGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9010");
    internal static readonly Guid CeilingFtGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9011");
    internal static readonly Guid PeopleGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9012");
    internal static readonly Guid LightingWGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9013");
    internal static readonly Guid EquipSensibleGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9014");
    internal static readonly Guid EquipLatentGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9015");
    internal static readonly Guid VentilationCfmGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9016");

    public const string RoleZoningRegion = "zoning-region";
    public const string RoleRoomRegion = "room-region";
    public const string RoleHeldResidue = "held-residue";

    private sealed record Carrier(SharedDefinitionSpec Definition, BuiltInCategory Category);

    private static readonly IReadOnlyList<Carrier> AdoptionCarriers =
    [
        new(new SharedDefinitionSpec("_PE_TakeoffRole", SpecTypeId.String.Text,
                Description: "Pe takeoff region role (zoning-region | room-region | held-residue).",
                Guid: RoleGuid, Visible: false, UserModifiable: false), BuiltInCategory.OST_DetailComponents),
        new(new SharedDefinitionSpec("_PE_TakeoffGuid", SpecTypeId.String.Text,
                Description: "Pe takeoff stable region identity.",
                Guid: RegionGuid, Visible: false, UserModifiable: false), BuiltInCategory.OST_DetailComponents),
        new(OwnerBlobStore.Spec(Provenance), BuiltInCategory.OST_DetailComponents),
        new(OwnerBlobStore.Spec(SystemRegistry.Owner), BuiltInCategory.OST_ProjectInformation),
    ];

    private static readonly Carrier RoomTypeCarrier = new(
        new SharedDefinitionSpec("PE_M___RoomType", SpecTypeId.String.Text,
            Description: "Takeoffs room classification used by Manual J assists.",
            Guid: RoomTypeGuid),
        BuiltInCategory.OST_DetailComponents);

    private static Carrier RoomField(string name, ForgeTypeId spec, Guid guid, string description) =>
        new(new SharedDefinitionSpec(name, spec, Description: description, Guid: guid), BuiltInCategory.OST_DetailComponents);

    private static readonly IReadOnlyList<Carrier> RoomFieldCarriers =
    [
        RoomField("PE_M___RoomName", SpecTypeId.String.Text, RoomNameGuid, "Rooms room name."),
        RoomField("PE_M___CeilingFt", SpecTypeId.Number, CeilingFtGuid, "Rooms ceiling height, feet."),
        RoomField("PE_M___People", SpecTypeId.Number, PeopleGuid, "Rooms occupant count."),
        RoomField("PE_M___LightingW", SpecTypeId.Number, LightingWGuid, "Rooms lighting load, watts."),
        RoomField("PE_M___EquipSensible", SpecTypeId.Number, EquipSensibleGuid, "Rooms equipment sensible load."),
        RoomField("PE_M___EquipLatent", SpecTypeId.Number, EquipLatentGuid, "Rooms equipment latent load."),
        RoomField("PE_M___VentilationCfm", SpecTypeId.Number, VentilationCfmGuid, "Rooms ventilation, cfm."),
    ];

    public static TakeoffCarrierPreflight Preflight(
        Document document,
        TakeoffCarrierStage stage = TakeoffCarrierStage.Adoption)
    {
        var missing = Required(stage)
            .Where(carrier => !IsBound(document, carrier))
            .Select(carrier => carrier.Definition.Guid!.Value)
            .ToList();
        return new TakeoffCarrierPreflight(
            stage,
            missing.Count == 0 ? "ready" : "needs-initialization",
            missing);
    }

    // Idempotent; caller owns the transaction. One call binds at most one carrier so each slow
    // Revit binding has its own durable Host receipt.
    public static TakeoffCarrierInitializationData InitializeNext(
        Document document,
        TakeoffCarrierStage stage)
    {
        var next = Required(stage).FirstOrDefault(carrier => !IsBound(document, carrier));
        if (next == null)
            return new TakeoffCarrierInitializationData("ready", null, []);

        SharedParameterBinder.EnsureProjectBinding(
            document,
            next.Definition,
            [next.Category]);
        // ADR 0011 / ledger ruling 3: a document that has been initialized answers with its declared
        // enclosure rather than the default. Idempotent, and the caller already owns the transaction.
        Pe.Revit.Partition.EnclosureDeclaration.EnsureBound(document);
        var remaining = Preflight(document, stage).MissingCarrierGuids;
        return new TakeoffCarrierInitializationData(
            remaining.Count == 0 ? "ready" : "needs-initialization",
            next.Definition.Guid,
            remaining);
    }

    public static void Require(Document document, TakeoffCarrierStage stage)
    {
        var preflight = Preflight(document, stage);
        if (preflight.MissingCarrierGuids.Count > 0)
            throw new TakeoffCarrierPrerequisiteException(preflight);
    }

    private static IReadOnlyList<Carrier> Required(TakeoffCarrierStage stage) => stage switch
    {
        TakeoffCarrierStage.Adoption => AdoptionCarriers,
        TakeoffCarrierStage.Materialization => [.. AdoptionCarriers, RoomTypeCarrier],
        TakeoffCarrierStage.Rooms => [.. AdoptionCarriers, RoomTypeCarrier, .. RoomFieldCarriers],
        _ => throw new ArgumentOutOfRangeException(nameof(stage), stage, null),
    };

    private static bool IsBound(Document document, Carrier carrier)
    {
        var element = SharedParameterElement.Lookup(document, carrier.Definition.Guid!.Value);
        return element != null && document.ParameterBindings.Contains(element.GetDefinition());
    }

    public static void WriteIdentity(FilledRegion region, string role, Guid guid)
    {
        Set(region, RoleGuid, role);
        Set(region, RegionGuid, guid.ToString("D"));
    }

    public static (string? Role, Guid? Guid) ReadIdentity(FilledRegion region)
    {
        string? role = region.get_Parameter(RoleGuid)?.AsString();
        string? raw = region.get_Parameter(RegionGuid)?.AsString();
        return (string.IsNullOrEmpty(role) ? null : role,
            Guid.TryParse(raw, out var guid) ? guid : null);
    }

    // The data is a dumb pipe here; its schema (and fail-closed parsing) belongs to the consumer. The text in and
    // out is the envelope's data; the envelope, the version rule and the refusal to overwrite belong to the store.
    public static void WriteProvenance(FilledRegion region, string json)
    {
        // Dates stay strings so the stored data is the consumer's text, not a reformatted copy.
        using var reader = new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None };
        WriteProvenance(region, JObject.Load(reader));
    }

    public static void WriteProvenance(FilledRegion region, JObject data) =>
        _ = OwnerBlobStore.Write(region, Provenance, data);

    // A read never throws for a blob this build cannot read: the refusal is the value (ADR 0039 keep).
    internal static OwnerBlobRead ReadProvenanceBlob(FilledRegion region) => OwnerBlobStore.Read(region, Provenance);

    // The stored data text for the wire; null when the region holds no envelope.
    public static OwnerValue<string> TryReadProvenance(FilledRegion region) =>
        ReadProvenanceBlob(region).Parse(data => data.ToString(Formatting.None));

    // The one region read. No envelope is RegionProvenance.Default. A listing reports a refusal and goes on; a
    // write run calls OrThrow, because a run that cannot say which zone a region belongs to must not write around it.
    public static OwnerValue<RegionProvenance> ReadRegion(FilledRegion region) =>
        RegionProvenance.Read(ReadProvenanceBlob(region));

    public static void WriteRoomType(FilledRegion region, string roomType) =>
        Set(region, RoomTypeGuid, roomType);

    public static string ReadRoomType(FilledRegion region) =>
        region.get_Parameter(RoomTypeGuid)?.AsString() is { Length: > 0 } value ? value : "hall";

    public static RoomFields ReadRoomFields(FilledRegion region) => new(
        region.get_Parameter(RoomNameGuid)?.AsString() ?? "",
        ReadRoomType(region),
        Number(region, CeilingFtGuid), Number(region, PeopleGuid), Number(region, LightingWGuid),
        Number(region, EquipSensibleGuid), Number(region, EquipLatentGuid), Number(region, VentilationCfmGuid));

    // Writes only the fields that are set; null means "not given", never "clear".
    public static void WriteRoomFields(FilledRegion region, RoomFields fields)
    {
        if (fields.Name != null) Set(region, RoomNameGuid, fields.Name);
        if (fields.Type != null) WriteRoomType(region, fields.Type);
        foreach (var (guid, value) in new[] {
                     (CeilingFtGuid, fields.CeilingFt), (PeopleGuid, fields.People), (LightingWGuid, fields.LightingW),
                     (EquipSensibleGuid, fields.EquipSensible), (EquipLatentGuid, fields.EquipLatent),
                     (VentilationCfmGuid, fields.VentilationCfm) })
        {
            if (value is not { } v) continue;
            var parameter = region.get_Parameter(guid)
                            ?? throw new InvalidOperationException($"carrier {guid} is not bound on {region.Id} — initialize the Rooms carriers first.");
            if (parameter.IsReadOnly || !parameter.Set(v))
                throw new InvalidOperationException($"Revit rejected carrier write {guid} on {region.Id}.");
        }
    }

    private static double? Number(FilledRegion region, Guid guid) =>
        region.get_Parameter(guid) is { HasValue: true } p ? p.AsDouble() : null;

    // Absent blob = empty registry (a model that never registered a System). A stored blob that fails the codec is
    // a refusal value for a read (ADR 0039 keep), and stops a write run with its reason.
    public static OwnerValue<SystemRegistry> TryReadRegistry(Document document) =>
        SystemRegistry.Read(OwnerBlobStore.Read(document, SystemRegistry.Owner));

    public static SystemRegistry ReadRegistry(Document document) => TryReadRegistry(document).OrThrow() ?? new SystemRegistry();

    public static void WriteRegistry(Document document, SystemRegistry registry) =>
        _ = OwnerBlobStore.Write(document, SystemRegistry.Owner, registry.ToData());

    private static void Set(FilledRegion region, Guid guid, string value)
    {
        var parameter = region.get_Parameter(guid)
                        ?? throw new InvalidOperationException(
                            $"carrier {guid} is not bound on {region.Id} — initialize the required Takeoff carriers first.");
        if (parameter.IsReadOnly || !parameter.Set(value))
            throw new InvalidOperationException($"Revit rejected carrier write {guid} on {region.Id}.");
    }
}

public sealed class TakeoffCarrierPrerequisiteException(TakeoffCarrierPreflight preflight)
    : InvalidOperationException(
        $"Takeoff {preflight.Stage} needs carrier initialization: " +
        string.Join(", ", preflight.MissingCarrierGuids.Select(guid => guid.ToString("D"))))
{
    public TakeoffCarrierPreflight Preflight { get; } = preflight;
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
