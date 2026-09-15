/**
 * The Ops route, declared once. Ops reads two subjects — the generated operation catalogue and
 * the capability catalogue — and has exactly one action: run the selected operation. The old
 * `ops/product.ts` (Slots, Feeds, Stages, Verbs, Panes) is deleted; its only surviving judgement
 * is `opsRefusal`, which now answers `run.ready`.
 */
import { z } from "zod";
import { isTsOnlyOperationKey } from "@pe/host-contracts/operation-types";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";

import { defineRoute, type RouteManifest } from "#/route";

export type HostOperationCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};

export type OpsReading = "catalog" | "capabilities";

/** What the Page holds: which operation is selected and what its request pane has drafted. */
export interface OpsPage {
  op: string;
  session: string;
  openId: string;
}

const opsPage = z.object({
  op: z.string().default(""),
  session: z.string().default(""),
  openId: z.string().default(""),
});

/**
 * Why an operation cannot run yet. Metadata is untrusted: an operation with no intent or no
 * `needs` is refused rather than guessed at, and a mutation never runs on an observed session.
 */
export const opsRefusal = (
  operation: HostOperationCatalogEntry | undefined,
  custody: "controlled" | "observed" | undefined,
  selected?: { session?: string; openId?: string },
): string | null =>
  !operation
    ? "pick an operation"
    : !operation.intent || !operation.needs
      ? "Operation readiness metadata is unavailable"
      : isTsOnlyOperationKey(operation.key)
        ? null
        : selected && !selected.session
          ? "select the exact Revit session for this operation"
          : selected && operation.needs !== "nothing" && !selected.openId
            ? "select the exact open document for this operation"
            : custody === "observed" && operation.intent.toLowerCase() === "mutate"
              ? "mutating operations require a controlled world"
              : null;

/** What the route needs from the live surface to run its one action. */
export interface OpsRouteDeps {
  /** The catalogue entry the page has selected, and the custody of the session it would run on. */
  selected?: HostOperationCatalogEntry;
  custody?: "controlled" | "observed";
  request?: () => unknown;
  run?: (input: { opKey: string; request: () => unknown }) => Promise<unknown>;
}

export const opsManifest = (
  deps: OpsRouteDeps = {},
): RouteManifest<never, OpsReading, OpsPage, "run"> =>
  defineRoute<never, OpsReading, OpsPage, "run">({
    key: "ops",
    name: "Operations",
    readings: {
      /** The generated operation catalogue, narrowed to the page's bridge session when it has one. */
      catalog: { kind: "ops-catalog" },
      /** The one capability catalogue; the catalogue section below reads the same subject. */
      capabilities: { kind: "capabilities" },
    },
    page: opsPage,
    actions: {
      run: {
        label: "Run",
        says: "runs the selected operation against the exact session and open document the page names",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["catalog"],
        ready: (ctx) =>
          opsRefusal(deps.selected, deps.custody, {
            session: ctx.page?.session,
            openId: ctx.page?.openId,
          }),
        run: async (ctx) => {
          const operation = deps.selected;
          if (!operation) throw Error("pick an operation first");
          if (deps.run) {
            await deps.run({ opKey: operation.key, request: deps.request ?? (() => undefined) });
            return;
          }
          await ctx.call(operation.key, deps.request?.());
        },
      },
    },
    views: [
      { key: "request", label: "request", draws: () => null },
      { key: "result", label: "result", draws: () => null },
    ],
  });
