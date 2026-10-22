using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.apply` contract: write fitting coefficients, terminal and component drops, fan static
// into Revit, plus Pe's provenance store. PreviewOnly plans every write and opens no transaction.

/// <summary>
///     A fitting write names its Method: PeServer points the fitting at the Pe loss server, which reads the family's
///     coefficient parameter live (the FittingCoefficient slot, default Pe_C); AshraeTable stores Table as Revit's
///     ASHRAETableName and Revit looks the legs up itself; SpecificCoefficient freezes Coefficient (the export route,
///     never the web's). Coefficient, Table, Inputs and RuleKey are Pe's provenance and land in the store.
///     Terminals and Components carry a drop in in-wg; Equipment the fan external static; TerminalFlows and EquipmentFlows
///     a design flow in cfm (the TerminalFlow slot on the terminal instance, the FanFlow slot on the unit).
/// </summary>
public sealed record DuctApplyRequest(
    bool PreviewOnly,
    DuctParameterSlots? Slots,
    IReadOnlyList<DuctFittingWrite> Fittings,
    IReadOnlyList<DuctDropWrite> Terminals,
    IReadOnlyList<DuctDropWrite> Components,
    IReadOnlyList<DuctEquipmentWrite> Equipment,
    IReadOnlyList<DuctFlowWrite> TerminalFlows,
    IReadOnlyList<DuctFlowWrite> EquipmentFlows,
    DuctLossStore Store);

/// <summary>Table is the rule's ASHRAE table the Pe server prices the legs from when the family carries no coefficient; Coefficient is the web's number for the store and the export route.</summary>
public sealed record DuctFittingWrite(long Id, DuctFittingMethod Method, double Coefficient, string? Table, string? Inputs, string? RuleKey);

/// <summary>How Revit is told a fitting's loss (pressure-drop ledger, 2026-10-12): the Pe server live, or a frozen number for export.</summary>
[JsonConverter(typeof(Newtonsoft.Json.Converters.StringEnumConverter))]
public enum DuctFittingMethod {
    [System.Runtime.Serialization.EnumMember(Value = "pe-server")] PeServer,
    [System.Runtime.Serialization.EnumMember(Value = "specific-coefficient")] SpecificCoefficient
}

public sealed record DuctDropWrite(long Id, double InWg, string? Source);

public sealed record DuctEquipmentWrite(long Id, double ExternalStaticInWg);

/// <summary>A design flow in cfm and where it came from (override, load preview, rooms, a person's note).</summary>
public sealed record DuctFlowWrite(long Id, double Cfm, string? Source);

/// <summary>StoreRevision is the store's WorkRevision after this call (unchanged on preview).</summary>
public sealed record DuctApplyResult(
    bool PreviewOnly,
    IReadOnlyList<DuctWrite> Writes,
    DuctApplyCounts Counts,
    IReadOnlyList<DuctSystem>? SystemsAfter,
    int StoreRevision);

/// <summary>
///     One target's outcome. Kind: fitting, terminal, component, equipment, terminal-flow, equipment-flow, store, and the
///     store entries a write changes: slot (Key names the slot), verdict (Key is the issue or finding id, Id its first
///     element) and role (Id is the unit). Outcome: planned (preview), written, refused (Reason says why), unchanged
///     (already holds the value). Before and After are display text; "none" is no entry.
/// </summary>
public sealed record DuctWrite(long? Id, string Kind, string Outcome, string? Reason, string? Before, string? After, string? Key = null);

public sealed record DuctApplyCounts(int Planned, int Written, int Refused, int Unchanged);

/// <summary>A rule's chosen ASHRAE table (rule key is family:type plus a geometry condition, owned by the web).</summary>
public sealed record DuctRuleChoice(string? Table);

/// <summary>What Pe wrote on one fitting: the table and lookup inputs behind the coefficient.</summary>
public sealed record DuctInstanceRecord(string? Table, string? Inputs, double Coefficient, DateTimeOffset AppliedAt);

/// <summary>What Pe wrote on one terminal or component: the drop and where it came from (catalog, typed).</summary>
public sealed record DuctDropRecord(double InWg, string? Source, DateTimeOffset AppliedAt);

/// <summary>What Pe wrote on one terminal or unit: the design flow in cfm and where it came from.</summary>
public sealed record DuctFlowRecord(double Cfm, string? Source, DateTimeOffset AppliedAt);

/// <summary>
///     A person's ruling on an issue or inferred-join finding id: `ignore` leaves an open end out of the walk, or
///     withholds (objects to) an inferred join.
/// </summary>
public sealed record DuctVerdictRecord(string Verdict, DateTimeOffset RuledAt);

/// <summary>A person's ruling on an air mover: `passive` moves no design air (or `fan`, the default, said aloud).</summary>
public sealed record DuctRoleRecord(string Role, DateTimeOffset RuledAt);

/// <summary>
///     Pe's provenance for duct losses: one versioned JSON blob in the hidden Project Information text parameter
///     `_PE_DuctLosses` (pressure-drop ledger: never extensible storage). WorkRevision counts applies; a request
///     carrying an older revision than the model holds is stale. Unknown keys survive read-modify-write.
///     v2 adds the rulings that remain after healing (pressure-drop ledger, 2026-10-20): Verdicts keyed by issue or
///     finding id, Roles keyed by unit id. They live here, not on elements and not in Pe Work; Work holds only pending
///     edits. A v1 blob reads as v2 with no rulings; every write is v2.
/// </summary>
public sealed record DuctLossStore {
    public const int CurrentVersion = 2;

    // No default: a blob without a version is not a store.
    public int Version { get; init; }
    public Dictionary<string, DuctRuleChoice> Rules { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<long, DuctInstanceRecord> Instances { get; init; } = new();
    public Dictionary<long, DuctDropRecord> Terminals { get; init; } = new();
    public Dictionary<long, DuctFlowRecord> TerminalFlows { get; init; } = new();
    public Dictionary<long, DuctFlowRecord> EquipmentFlows { get; init; } = new();
    public Dictionary<string, DuctVerdictRecord> Verdicts { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<long, DuctRoleRecord> Roles { get; init; } = new();
    public DuctParameterSlots? Slots { get; init; }
    public int WorkRevision { get; init; }
    public DateTimeOffset? AppliedAt { get; init; }

    [JsonExtensionData]
    public IDictionary<string, JToken> Unknown { get; init; } = new Dictionary<string, JToken>();

    public string ToJson() => JsonConvert.SerializeObject(this, Formatting.None, Settings());

    /// <summary>Fail-closed: invalid JSON or any version but 1 or <see cref="CurrentVersion" /> throws.</summary>
    public static DuctLossStore FromJson(string json) {
        DuctLossStore store;
        try {
            store = JsonConvert.DeserializeObject<DuctLossStore>(json, Settings())
                    ?? throw new InvalidOperationException("duct loss store is empty");
        } catch (JsonException ex) {
            throw new InvalidOperationException($"duct loss store is not valid JSON: {ex.Message}");
        }
        return store.Version is 1 or CurrentVersion
            ? store
            : throw new InvalidOperationException($"duct loss store is v{store.Version}; this build reads v1 and v{CurrentVersion}");
    }

    private static JsonSerializerSettings Settings() {
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        return settings;
    }
}
