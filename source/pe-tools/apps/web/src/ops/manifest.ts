/**
 * The Ops route, declared once. It is the host op runner: the situation ladder picks the target,
 * the catalogue picks the op, the schema draws the form, `run` is the one verb. Every gate the
 * runner needs is either the harness's target refusal (from `needs`) or `opsRefusal` below.
 */
import { z } from "zod";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";

import { defineRoute, type Ctx, type RouteManifest } from "#/route";

export type HostOperationCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

export type Custody = "controlled" | "observed";
export type OpsReading = "inventory";
export type OpsCtx = Ctx<never, OpsReading, Record<string, never>>;

const NEEDS = {
  nothing: "session",
  document: "document",
  "project-document": "project",
  "family-document": "family",
} as const;

/** What the harness must resolve before this op may run. A host-local op needs no Revit. */
export const opNeeds = (op?: HostOperationCatalogEntry) =>
  !op || isTsOnlyOperationKey(op.key) ? "host" : NEEDS[op.needs];

export const isMutation = (op?: HostOperationCatalogEntry) =>
  op?.intent?.toLowerCase() === "mutate";

/**
 * Why the selected op cannot run, beyond the target the harness resolves. Intent is judged
 * before origin: a mutation on a Revit session runs only under controlled custody. A host-local
 * mutation has no custody to judge and is audited by the action journal instead (`run.ts`).
 */
export const opsRefusal = (op: HostOperationCatalogEntry | undefined, custody?: Custody) =>
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
    // A session is always asked for so the catalogue can list that session's ops; a host-local
    // op still runs without one because its verb needs only the host.
    needs: needs === "host" ? "session" : needs,
    readings: { inventory: { kind: "inventory" } },
    actions: {
      run: {
        label: "Run",
        says: "runs the selected operation on the target the sentence names",
        needs,
        actor: "human",
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
