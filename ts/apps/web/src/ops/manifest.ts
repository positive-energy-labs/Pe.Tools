/**
 * The Ops route, declared once. It is the host op runner: the situation ladder picks the target,
 * the catalogue picks the op, the schema draws the form, `run` is the one verb. Every gate the
 * runner needs is either the harness's target refusal (from `needs`) or `opsRefusal` below.
 */
import { z } from "zod";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";

import { defineRoute, targetNeed, type Ctx, type HostRecord, type RouteManifest } from "#/route";

export type HostOperationCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

type Custody = "controlled" | "observed";
export type OpsReading = "inventory";
type OpsCtx = Ctx<never, OpsReading, Record<string, never>>;

/**
 * The selected operation's record, as the Run verb's `does`. A host-local op needs nothing; a
 * native op with no document need still needs the session that lists it. Its press is human.
 */
const opRecord = (op?: HostOperationCatalogEntry): HostRecord => ({
  says: "runs the selected operation on the target the sentence names",
  actor: "human",
  needs:
    !op || isTsOnlyOperationKey(op.key) ? "nothing" : op.needs === "nothing" ? "session" : op.needs,
});
const opNeeds = (op?: HostOperationCatalogEntry) => targetNeed(opRecord(op).needs);

export const isMutation = (op?: HostOperationCatalogEntry) =>
  op?.intent?.toLowerCase() === "mutate";

/**
 * Why the selected op cannot run, beyond the target the harness resolves. Intent is judged
 * before origin: a mutation on a Revit session runs only under controlled custody. A host-local
 * mutation has no custody to judge and is audited by the action journal instead (`run.ts`).
 */
const opsRefusal = (op: HostOperationCatalogEntry | undefined, custody?: Custody) =>
  !op
    ? "pick an operation"
    : !op.intent
      ? "Operation readiness metadata is unavailable"
      : isMutation(op) && opNeeds(op) !== "host" && custody !== "controlled"
        ? "mutating operations require a controlled world"
        : null;

export interface OpsRouteDeps {
  selected?: HostOperationCatalogEntry;
  custody?: Custody;
  run?: (ctx: OpsCtx) => Promise<void>;
}

export const opsManifest = (
  deps: OpsRouteDeps = {},
): RouteManifest<never, OpsReading, Record<string, never>, "run"> => {
  const needs = opNeeds(deps.selected);
  return defineRoute<never, OpsReading, Record<string, never>, "run">({
    key: "ops",
    name: "Ops",
    docs: "Select an operation, inspect its required target and custody, then run it only after the route can resolve those requirements.",
    // A session is always asked for so the catalogue can list that session's ops; a host-local
    // op still runs without one because its verb needs only the host.
    needs: needs === "host" ? "session" : needs,
    readings: { inventory: { kind: "inventory" } },
    actions: {
      run: {
        label: "Run",
        does: () => opRecord(deps.selected),
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        chord: "Mod+Enter",
        ready: () => opsRefusal(deps.selected, deps.custody),
        run: async (ctx) => {
          if (!deps.run) throw Error("pick an operation first");
          await deps.run(ctx);
        },
      },
    },
  });
};
