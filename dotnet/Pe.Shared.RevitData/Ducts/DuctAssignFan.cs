namespace Pe.Shared.RevitData.Ducts;

// The `ducts.assign-fan` contract (pressure-drop ledger, 2026-10-21: Revit's Duct Systems > Select Equipment
// as a Pe verb; spike `.artifacts/runs/close-ducts-v1/assignfan/`). A unit becomes a duct system's base
// equipment, the first rung of the fan proposal (`@pe/ducts-domain/unit-roles.ts`). The op refuses a system
// that already has base equipment (a swap drops the old base from the members and Revit does not put it
// back), and a unit with no port of the system's air classification in that system or on its ducts (Revit
// has no such check: a unit of another system becomes the base). PreviewOnly runs the write and its read
// back and rolls it back.

/// <summary>SystemId is the MechanicalSystem; UnitId the mechanical equipment to make its base equipment.</summary>
public sealed record DuctAssignFanRequest(bool PreviewOnly, long SystemId, long UnitId);

/// <summary>
///     Outcome: planned (preview), assigned, refused (Reason says why; nothing changed). Connector is the
///     unit's connector index made the base. Check is the read back's words. Before and After are the system as
///     Revit reports it (After inside the rolled-back run on preview; null when refused).
/// </summary>
public sealed record DuctAssignFanResult(
    bool PreviewOnly,
    long SystemId,
    long UnitId,
    string Outcome,
    string? Reason,
    int? Connector,
    string? Check,
    DuctSystem? Before,
    DuctSystem? After);
