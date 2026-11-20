using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.apply` contract: write fitting coefficients, terminal and component drops, fan static
// into Revit, plus Pe's provenance store. Its Read sibling `ducts.apply.plan` plans every write and
// opens no transaction; the request carries no preview flag, the op key is the mode.

/// <summary>Host-priced losses, drops in in-wg and design flows in cfm. The plan opens no transaction.</summary>
public sealed record DuctApplyRequest(
    DuctParameterSlotOverrides? Slots,
    IReadOnlyList<DuctFittingWrite> Fittings,
    IReadOnlyList<DuctDropWrite> Terminals,
    IReadOnlyList<DuctDropWrite> Components,
    IReadOnlyList<DuctEquipmentWrite> Equipment,
    IReadOnlyList<DuctFlowWrite> TerminalFlows,
    IReadOnlyList<DuctFlowWrite> EquipmentFlows,
    DuctLossStore Store,
    DuctStoreDeletes? StoreDeletes = null,
    OwnerBlobReplacement? Replacement = null);

/// <summary>
///     Store keys this write removes. The store is overlaid per key: a key the request omits keeps its stored entry,
///     so only a key named here is removed (K3: omission is never deletion).
/// </summary>
public sealed record DuctStoreDeletes {
    public List<string> Rules { get; init; } = [];
    public List<string> Instances { get; init; } = [];
    public List<string> Terminals { get; init; } = [];
    public List<string> TerminalFlows { get; init; } = [];
    public List<string> EquipmentFlows { get; init; } = [];
    public List<string> Verdicts { get; init; } = [];
    public List<string> Roles { get; init; } = [];
}

/// <summary>Results are the host engine's priced legs, including their velocity-pressure basis. Table and Inputs are provenance only.</summary>
public sealed record DuctFittingWrite(long Id, DuctFittingMethod Method, double Coefficient, string? Table, string? Inputs, string? RuleKey,
    IReadOnlyList<DuctLossResult>? Results = null);

/// <summary>A signed host coefficient at one velocity pressure in in-wg. Native code refuses changed or ambiguous bases.</summary>
public sealed record DuctLossResult(double VelocityPressureInWg, double Coefficient) {
    /// <summary>
    ///     The per-fitting results entity of Pe's pressure-loss server. It is the one Extensible Storage Pe writes,
    ///     because Revit's server API requires it (ADR 0032 storage amendment, rule 7). The GUID and name are the
    ///     schema's; the schema's one text field holds the envelope.
    /// </summary>
    public static readonly OwnerDescriptor Owner = new("duct-loss-results", 1,
        new Guid("5e1f0c0e-7e10-4c0e-9e1f-0000c0ef0003"), "PeDuctLossResults",
        "Host-priced coefficients and velocity-pressure bases. Reapply from Pe when the basis changes.");

    public static string Encode(IReadOnlyList<DuctLossResult> results) =>
        OwnerBlob.Encode(Owner, new JObject { ["results"] = JArray.FromObject(results, RevitDataJson.CreateStoredSerializer()) });

    /// <summary>Null when the text is absent or refused: the server then prices nothing and the person reapplies.</summary>
    public static IReadOnlyList<DuctLossResult>? Decode(string? text) {
        if (OwnerBlob.Decode(Owner, text) is not { Status: OwnerBlobStatus.Ok, Data: { Count: 1 } data } || data["results"] is not JArray results)
            return null;
        try {
            return results.ToObject<List<DuctLossResult>>(RevitDataJson.CreateStoredSerializer());
        } catch (JsonException) {
            return null;
        }
    }
}

/// <summary>Consume host results in Pe's server, or freeze one coefficient for export.</summary>
[JsonConverter(typeof(Newtonsoft.Json.Converters.StringEnumConverter))]
public enum DuctFittingMethod {
    [System.Runtime.Serialization.EnumMember(Value = "pe-server")] PeServer,
    [System.Runtime.Serialization.EnumMember(Value = "specific-coefficient")] SpecificCoefficient
}

public sealed record DuctDropWrite(long Id, double InWg, string? Source);

public sealed record DuctEquipmentWrite(long Id, double ExternalStaticInWg);

/// <summary>A design flow in cfm and where it came from (override, load preview, rooms, a person's note).</summary>
public sealed record DuctFlowWrite(long Id, double Cfm, string? Source, string? Slot = null);

/// <summary>
///     StoreRevision is the store's WorkRevision after this call (unchanged on preview). Worksharing is set on a preview of a
///     workshared document: what the commit will borrow. Replacement is set on preview when the old store is unreadable.
/// </summary>
public sealed record DuctApplyResult(
    bool PreviewOnly,
    IReadOnlyList<DuctWrite> Writes,
    DuctApplyCounts Counts,
    IReadOnlyList<DuctSystem>? SystemsAfter,
    int StoreRevision,
    WorksharingDisclosure? Worksharing = null,
    OwnerBlobReplacement? Replacement = null);

/// <summary>
///     One target's outcome. Kind: fitting, terminal, component, equipment, terminal-flow, equipment-flow, store, and the
///     store entries a write changes: slot (Key names the slot), verdict (Key is the issue or finding id, Id its first
///     element) and role (Id is the unit). Outcome: planned (preview), written, refused (Reason says why), unchanged
///     (already holds the value). Before and After are display text; "none" is no entry. UniqueId is the durable key.
///     Id and ElementLabel identify an extant native target;
///     Parameter and Scope name its native setting and owner. Changes expands a target into parameter review rows without
///     multiplying execution targets or counts. ReportedPressureDropInWg is effective pressure, not a stored setting.
/// </summary>
public sealed record DuctWrite(long? Id, string Kind, string Outcome, string? Reason, string? Before, string? After, string? Key = null,
    string? ElementLabel = null, string? UniqueId = null, string? Parameter = null, string? Scope = null,
    IReadOnlyList<DuctParameterChange>? Changes = null, double? ReportedPressureDropInWg = null);

/// <summary>One parameter's native setting before and intended setting after. Unset is not zero. Method states have no units.</summary>
public sealed record DuctParameterChange(string Parameter, string? Before, string? After);

public sealed record DuctApplyCounts(int Planned, int Written, int Refused, int Unchanged);

/// <summary>A rule's chosen ASHRAE table (rule key is family:type plus a geometry condition, owned by the web).</summary>
public sealed record DuctRuleChoice(string? Table);

/// <summary>What Pe wrote on one fitting: the table and lookup inputs behind the coefficient.</summary>
public sealed record DuctInstanceRecord(string? Table, string? Inputs, double Coefficient, DateTimeOffset AppliedAt);

/// <summary>What Pe wrote on one terminal or component: the drop and where it came from (catalog, typed).</summary>
public sealed record DuctDropRecord(double InWg, string? Source, DateTimeOffset AppliedAt);

/// <summary>What Pe wrote on one terminal or unit: the design flow in cfm and where it came from.</summary>
public sealed record DuctFlowRecord(double Cfm, string? Source, DateTimeOffset AppliedAt, string? Parameter = null);

/// <summary>
///     A person's ruling on an issue or inferred-join finding id: `ignore` leaves an open end out of the walk, or
///     withholds (objects to) an inferred join.
/// </summary>
public sealed record DuctVerdictRecord(string Verdict, DateTimeOffset RuledAt);

/// <summary>A person's ruling on an air mover: `passive` moves no design air (or `fan`, the default, said aloud).</summary>
public sealed record DuctRoleRecord(string Role, DateTimeOffset RuledAt);

/// <summary>
///     Pe's provenance for duct losses: one owner blob in the hidden Project Information text parameter
///     `_PE_DuctLosses` (pressure-drop ledger: never extensible storage). WorkRevision counts applies; a request
///     carrying an older revision than the model holds is stale. Unknown keys survive read-modify-write.
///     Element maps use Revit UniqueId. Rules use authored rule keys and Verdicts use issue or finding IDs.
///     Older envelopes are unreadable. Only explicit replacement can supersede one.
///
/// </summary>
public sealed record DuctLossStore {
    public const int CurrentVersion = 3;

    public static readonly OwnerDescriptor Owner = new("duct-losses", CurrentVersion,
        new Guid("91e80aa7-f842-43ac-adbe-9b1f6a40c2d2"), "_PE_DuctLosses", "Versioned Pe.Tools duct loss provenance (ducts.apply).") { ValidateData = read => Read(read).Refusal };

    /// <summary>On the wire only. In the model the version is the envelope's, so the stored data holds none.</summary>
    public int Version { get; init; } = CurrentVersion;
    public Dictionary<string, DuctRuleChoice> Rules { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, DuctInstanceRecord> Instances { get; init; } = new();
    public Dictionary<string, DuctDropRecord> Terminals { get; init; } = new();
    public Dictionary<string, DuctFlowRecord> TerminalFlows { get; init; } = new();
    public Dictionary<string, DuctFlowRecord> EquipmentFlows { get; init; } = new();
    public Dictionary<string, DuctVerdictRecord> Verdicts { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, DuctRoleRecord> Roles { get; init; } = new();
    public DuctParameterSlotOverrides? Slots { get; init; }
    public int WorkRevision { get; init; }
    public DateTimeOffset? AppliedAt { get; init; }

    [JsonExtensionData]
    public IDictionary<string, JToken> Unknown { get; init; } = new Dictionary<string, JToken>();

    /// <summary>The stored text: the owner envelope around <see cref="ToData" />.</summary>
    public string ToJson() => OwnerBlob.Encode(Owner, this.ToData());

    public JObject ToData() {
        var data = JObject.FromObject(this, RevitDataJson.CreateStoredSerializer());
        _ = data.Remove("version");
        return data;
    }

    /// <summary>
    ///     The stored map overlaid per key by the request's entries, minus the keys explicitly deleted. A key neither
    ///     names keeps its stored entry, so a sparse request can never drop what it did not mention.
    /// </summary>
    public static Dictionary<TKey, TValue> Overlay<TKey, TValue>(IReadOnlyDictionary<TKey, TValue>? stored,
        IReadOnlyDictionary<TKey, TValue>? asked, IEnumerable<TKey>? deletes, IEqualityComparer<TKey>? comparer = null)
        where TKey : notnull {
        var next = new Dictionary<TKey, TValue>(comparer);
        foreach (var kv in stored ?? new Dictionary<TKey, TValue>()) next[kv.Key] = kv.Value;
        foreach (var kv in asked ?? new Dictionary<TKey, TValue>()) next[kv.Key] = kv.Value;
        foreach (var key in deletes ?? []) next.Remove(key);
        return next;
    }

    /// <summary>The model's store, or the reason it is "can't read, kept".</summary>
    public static OwnerValue<DuctLossStore> Read(OwnerBlobRead read) => read.Parse(FromData);

    private static DuctLossStore FromData(JObject data) {
        if (data.ContainsKey("version"))
            throw new InvalidOperationException("duct loss store data holds a version; the version belongs to the envelope");
        try {
            var store = data.ToObject<DuctLossStore>(RevitDataJson.CreateStoredSerializer())!;
            var keys = store.Instances.Keys.Concat(store.Terminals.Keys).Concat(store.TerminalFlows.Keys)
                .Concat(store.EquipmentFlows.Keys).Concat(store.Roles.Keys);
            if (keys.Any(key => string.IsNullOrEmpty(key) || long.TryParse(key, out _)))
                throw new InvalidOperationException("duct loss store element keys must be Revit UniqueIds");
            return store;
        } catch (JsonException ex) {
            throw new InvalidOperationException($"duct loss store data is not valid: {ex.Message}");
        }
    }
}
