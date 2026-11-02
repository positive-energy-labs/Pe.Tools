import type { DuctsApplyInput } from "@pe/agent-contracts";
import type { SheetSnapshot } from "./build.ts";
import type { Sheet } from "./types.ts";

/** A fan commit includes the accessory losses it calculated, not only manually typed drops. */
export function accessoryWrites(
  snapshot: SheetSnapshot,
  sheet: Sheet,
): DuctsApplyInput["components"] {
  const accessories = new Set(
    snapshot.nodes.filter((n) => n.kind === "accessory").map((n) => n.id),
  );
  return sheet.fittings
    .flatMap((f) =>
      f.elementId != null && accessories.has(f.elementId) && f.lossInWg != null && !f.unpriced
        ? [{ id: f.elementId, inWg: f.lossInWg, source: f.derivation ?? f.table }]
        : [],
    )
    .sort((a, b) => a.id - b.id);
}
