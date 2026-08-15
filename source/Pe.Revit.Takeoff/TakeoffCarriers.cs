using Pe.Revit.Parameters;

namespace Pe.Revit.Takeoff;

// The one place that spells takeoff's persistence homes (README data-homes table). Everything
// above speaks FRs and the registry only through this module — nobody else touches a Parameter.
// Pattern and proof: live FR write round-trip 2026-08-14 (DECISIONS); mirrors
// ParameterLinksProfileStorage for the Project Information blob. Extensible storage is banned.
public static class TakeoffCarriers
{
    // Stable carrier identities. Changing any of these orphans deployed models — never reuse.
    internal static readonly Guid RoleGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9001");
    internal static readonly Guid RegionGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9002");
    internal static readonly Guid ProvenanceGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9003");
    internal static readonly Guid RegistryGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9004");
    internal static readonly Guid RoomTypeGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9005");

    public const string RoleZoningRegion = "zoning-region";
    public const string RoleRoomRegion = "room-region";
    public const string RoleHeldResidue = "held-residue";

    // Idempotent; caller owns the transaction. FR carriers ride an instance binding on Detail
    // Items (FilledRegion has no category of its own that accepts bindings — proven read+write).
    public static void EnsureBindings(Document document)
    {
        SharedParameterBinder.EnsureProjectBinding(document,
            new SharedDefinitionSpec("_PE_TakeoffRole", SpecTypeId.String.Text,
                Description: "Pe takeoff region role (zoning-region | room-region | held-residue).",
                Guid: RoleGuid, Visible: false, UserModifiable: false),
            [BuiltInCategory.OST_DetailComponents]);
        SharedParameterBinder.EnsureProjectBinding(document,
            new SharedDefinitionSpec("_PE_TakeoffGuid", SpecTypeId.String.Text,
                Description: "Pe takeoff stable region identity.",
                Guid: RegionGuid, Visible: false, UserModifiable: false),
            [BuiltInCategory.OST_DetailComponents]);
        SharedParameterBinder.EnsureProjectBinding(document,
            new SharedDefinitionSpec("_PE_TakeoffProvenance", SpecTypeId.String.Text,
                Description: "Pe takeoff machine bookkeeping blob (run id, source hash, .r10 link, holds).",
                Guid: ProvenanceGuid, Visible: false, UserModifiable: false),
            [BuiltInCategory.OST_DetailComponents]);
        SharedParameterBinder.EnsureProjectBinding(document,
            new SharedDefinitionSpec("PE_M___RoomType", SpecTypeId.String.Text,
                Description: "Takeoffs room classification used by Manual J assists.",
                Guid: RoomTypeGuid),
            [BuiltInCategory.OST_DetailComponents]);
        SharedParameterBinder.EnsureProjectBinding(document,
            new SharedDefinitionSpec("_PE_TakeoffSystemRegistry", SpecTypeId.String.Text,
                Description: "Versioned Pe takeoff System registry (GUID <-> tag).",
                Guid: RegistryGuid, Visible: false, UserModifiable: false),
            [BuiltInCategory.OST_ProjectInformation]);
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

    // The blob is a dumb pipe here; its schema (and fail-closed parsing) belongs to the consumer.
    public static void WriteProvenance(FilledRegion region, string json) =>
        Set(region, ProvenanceGuid, json);

    public static string? ReadProvenance(FilledRegion region) =>
        region.get_Parameter(ProvenanceGuid)?.AsString() is { Length: > 0 } s ? s : null;

    public static void WriteRoomType(FilledRegion region, string roomType) =>
        Set(region, RoomTypeGuid, roomType);

    public static string ReadRoomType(FilledRegion region) =>
        region.get_Parameter(RoomTypeGuid)?.AsString() is { Length: > 0 } value ? value : "hall";

    // Absent blob = empty registry (a model that never registered a System). Any stored blob that
    // fails the codec throws — fail closed, never proceed against a half-read registry.
    public static SystemRegistry ReadRegistry(Document document)
    {
        string? json = document.ProjectInformation?.get_Parameter(RegistryGuid)?.AsString();
        return string.IsNullOrWhiteSpace(json) ? new SystemRegistry() : SystemRegistry.Deserialize(json!);
    }

    public static void WriteRegistry(Document document, SystemRegistry registry)
    {
        var parameter = document.ProjectInformation?.get_Parameter(RegistryGuid)
                        ?? throw new InvalidOperationException(
                            "System registry parameter is not bound — run EnsureBindings first.");
        string json = registry.Serialize();
        if (string.Equals(parameter.AsString(), json, StringComparison.Ordinal)) return;
        if (!parameter.Set(json))
            throw new InvalidOperationException("Revit rejected the System registry blob.");
    }

    private static void Set(FilledRegion region, Guid guid, string value)
    {
        var parameter = region.get_Parameter(guid)
                        ?? throw new InvalidOperationException(
                            $"carrier {guid} is not bound on {region.Id} — run EnsureBindings first.");
        if (parameter.IsReadOnly || !parameter.Set(value))
            throw new InvalidOperationException($"Revit rejected carrier write {guid} on {region.Id}.");
    }
}
