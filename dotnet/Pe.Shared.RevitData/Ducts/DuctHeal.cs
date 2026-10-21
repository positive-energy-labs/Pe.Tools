using Newtonsoft.Json;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.heal` contract (pressure-drop ledger, 2026-10-20: heal what we can, as real geometry).
// The web classifies the candidates (`@pe/ducts-domain/heal.ts`); the op re-checks each one, runs it,
// checks the result with its own post-check (Revit's "connected" is not proof) and refuses and rolls
// back an item that fails. PreviewOnly runs every group and rolls all of it back; a real heal commits
// one transaction per group.

/// <summary>Groups are the approved systems; each group is one transaction on apply.</summary>
public sealed record DuctHealRequest(bool PreviewOnly, IReadOnlyList<DuctHealGroup> Groups);

/// <summary>Group is the route's group id (`g&lt;lowest element id&gt;`), a label only: the items name the geometry.</summary>
public sealed record DuctHealGroup(string Group, IReadOnlyList<DuctHealItem> Items);

/// <summary>
///     One repair. End and Other are connector keys `elementId:connectorIndex` as `ducts.snapshot` names them.
///     A cap closes End with the Caps routing rule of its duct type. A join meets End and Other: coincident ends
///     are connected, a small gap between two ducts gets a union fitting, a small gap from a duct to a part
///     extends the duct; the op picks which from the geometry and refuses anything outside its limits.
/// </summary>
public sealed record DuctHealItem(string Key, DuctHealKind Kind, string End, string? Other = null);

[JsonConverter(typeof(Newtonsoft.Json.Converters.StringEnumConverter))]
public enum DuctHealKind {
    [System.Runtime.Serialization.EnumMember(Value = "cap")] Cap,
    [System.Runtime.Serialization.EnumMember(Value = "join")] Join
}

public sealed record DuctHealResult(bool PreviewOnly, IReadOnlyList<DuctHealGroupOutcome> Groups, DuctHealCounts Counts);

/// <summary>
///     One group's run. Outcome: planned (preview), healed, refused (Reason says why: the group's transaction
///     failed and rolled back), empty (nothing healed). SystemsBefore and SystemsAfter are Revit's touched systems
///     with their critical path, read before the first item and after the last (inside the rolled-back run on
///     preview).
/// </summary>
public sealed record DuctHealGroupOutcome(
    string Group,
    string Outcome,
    string? Reason,
    IReadOnlyList<DuctHealOutcome> Items,
    IReadOnlyList<DuctSystem> SystemsBefore,
    IReadOnlyList<DuctSystem> SystemsAfter);

/// <summary>
///     One item. How: cap, connect, union, extend (null when refused before choosing). Outcome: planned (preview),
///     healed, refused. Created: new element ids (the cap, the union); Replaced: ids Revit deleted while healing (a
///     duct it split or rebuilt), each replaced by an id in Created. Check is the post-check's words.
///     On preview the ids are those of the rolled-back run and do not exist.
/// </summary>
public sealed record DuctHealOutcome(
    string Key,
    string Kind,
    string? How,
    string Outcome,
    string? Reason,
    IReadOnlyList<long> Created,
    IReadOnlyList<long> Replaced,
    string? Check);

public sealed record DuctHealCounts(int Planned, int Healed, int Refused);
