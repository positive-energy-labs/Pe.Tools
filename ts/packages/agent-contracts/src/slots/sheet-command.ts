import { z } from "zod";
import { sheetNativeOperations } from "@pe/host-contracts/operation-types";
import type { Command } from "../command.ts";
import type { ProductCommand } from "../product.ts";
import { ANY_ROUTE, workWriteCommands } from "../write-intent.ts";
import { SHEET_COMMANDS } from "./sheet.ts";

/*
 * Slice 7, the sheet slot (ADR 0035 rule 3; ADR 0030 rule 4): one plan/apply pair every sheet reaches
 * Revit through, builtin or Pod, bound to no one owner. The handle names the route; the host derives the
 * writes from that route's sheet bindings (a `parameter` binding through the generic parameter-value
 * leaves, a product record through its own writer).
 */
const sheetActions = {
  [SHEET_COMMANDS.plan]: {
    native: [...sheetNativeOperations.read, ...sheetNativeOperations.plan],
    says: "Plan the staged sheet writes without changing Revit. Pass the route's Work handle { key, revision } as work and any related Work handles as readWorks. The plan reports each write's outcome. Parameter bindings target each row's element by UniqueId and read its current parameter value.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  [SHEET_COMMANDS.apply]: {
    native: [...sheetNativeOperations.read, ...sheetNativeOperations.apply],
    says: "Write the planned sheet values to Revit in one transaction. Apply refuses if a value changed since the plan.",
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

declare module "../handle.ts" {
  interface ProductCommands extends Readonly<typeof sheetCommands> {}
}

/** The plan writes nothing. Apply's footprint comes from the product owning the admitted Work. */
export const sheetWritesFor = (
  writes: ProductCommand["writes"] | undefined,
): Readonly<Record<string, ProductCommand["writes"]>> =>
  writes === undefined ? {} : { [SHEET_COMMANDS.plan]: {}, [SHEET_COMMANDS.apply]: writes };
