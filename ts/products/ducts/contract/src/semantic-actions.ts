import { z } from "zod";
import type { Command } from "@pe/agent-contracts";
import { ANY_ROUTE, workWriteCommands } from "@pe/agent-contracts/write-intent";
import { SHEET_COMMANDS } from "@pe/agent-contracts/slots/sheet";

/*
 * Slice 7, the sheet slot (ADR 0035 rule 3; ADR 0030 rule 4): one plan/apply pair every sheet reaches
 * Revit through, builtin or Pod, bound to no one owner. The handle names the route; the host derives the
 * writes from that route's sheet bindings (a `parameter` binding through the generic parameter-value
 * leaves, the ducts losses store through its own). Other slots add their own keys in their own blocks.
 */
const sheetNative = [
  "revit.detail.parameter-values",
  "ducts.snapshot.walk",
  "ducts.snapshot.roster",
  "ducts.tables",
] as const;
export const sheetActions = {
  [SHEET_COMMANDS.plan]: {
    native: [...sheetNative, "ducts.apply.plan"],
    says: "Plan the staged sheet writes without changing Revit: pass the route's Work handle { key, revision } as work. A route with parameter bindings plans each staged cell as a parameter write on its row's element (by UniqueId) and reads the value Revit holds now. /fans plans the staged duct loss writes (fitting coefficients, terminal and component drops, fan static, unit roles): stage the fan walk { unitId, portIndex } from route:reads.value (read fans.roster) in route:fans writeIntent, and name rule cells in route:duct-systems writeIntent.cells to write those rules' fitting coefficients to elements after saving their tables. Pass the other Work as readWorks. With the rule-owning route's own Work handle, plan storing its staged rule tables and ignore verdicts and removing a stored verdict staged for delete. This plan has no element writes. Report each write's outcome; nothing is committed.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  [SHEET_COMMANDS.apply]: {
    native: [...sheetNative, "revit.apply.parameter-values", "ducts.apply"],
    says: "Write the planned sheet values to Revit exactly as the plan showed and a person approved, in one transaction; a value Revit changed since the plan refuses. /fans also records the loss provenance and unit roles in Project Information. /duct-systems applies its staged rule tables and ignore verdicts, removes a stored verdict staged for delete, and writes nothing to elements.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
} as const satisfies Record<string, Command>;
export const sheetCommands = workWriteCommands(
  ANY_ROUTE,
  SHEET_COMMANDS.apply,
  sheetActions[SHEET_COMMANDS.apply],
  {
    derive: (doc) => ({ doc }),
    preview: { key: SHEET_COMMANDS.plan, definition: sheetActions[SHEET_COMMANDS.plan] },
  },
);

declare module "@pe/agent-contracts/handle" {
  interface ProductCommands extends Readonly<typeof sheetCommands> {}
}
