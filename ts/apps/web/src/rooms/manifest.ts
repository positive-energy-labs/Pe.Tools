/**
 * The static /rooms contract: split one level's plan view into Room Regions, stage their fields
 * into Work, write the staged cells to Revit. Behavior is here; the page draws it (`route.tsx`).
 */
import { z } from "zod";
import type { RoomsPartition } from "@pe/host-contracts/generated";
import {
  roomEditAddress,
  roomsRouteState,
  stagedRoomWrites,
  transitionPatches,
  type RoomsRouteDocument,
} from "@pe/agent-contracts";

import { defineRoute, semanticActionInput, type Ctx } from "#/route/manifest";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import {
  actionResult,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

export const ROOMS_STAGES = [
  { key: "partition", word: "Partitioning rooms" },
  { key: "review", word: "Reviewing rooms" },
  { key: "history", word: "History" },
] as const;

export const roomsPageSchema = z.object({
  stage: z.enum(["partition", "review", "history"]).default("partition"),
  /** The plan view partition runs on; its level is the level. Empty = none chosen. */
  view: z.string().default(""),
  /** Region guids the plan and the table hold selected. */
  selected: z.array(z.string()).default([]),
  /** Bumped by every verb that lands; the snapshot read keys on it. */
  epoch: z.number().default(0),
});
export type RoomsPage = z.infer<typeof roomsPageSchema>;
export type RoomsReading = "receipts";
type RoomsCtx = Ctx<RoomsRouteDocument, RoomsReading, RoomsPage>;

const dispatch = async (
  ctx: RoomsCtx,
  key: "rooms.partition" | "rooms.write",
  input: Record<string, unknown>,
) => {
  if (ctx.target.kind !== "document") throw Error("An open document is required");
  // The host answers `{ value, target }` for every rooms action (takeoff-actions.ts); the value is the op's response.
  const answer = actionResult(
    await runSemanticAction(key, semanticActionInput(key, input), ctx.target.ref),
  ) as { value?: unknown };
  return answer.value ?? answer;
};

const stagedKeys = (ctx: RoomsCtx) =>
  Object.entries(ctx.work.doc?.edits ?? {}).filter(([, cell]) => cell.staged != null);
const bump = (ctx: RoomsCtx) => ctx.setPage({ epoch: ctx.page.epoch + 1 });
const none = z.void() as unknown as z.ZodType<never>;

export const manifest = defineRoute<
  RoomsRouteDocument,
  RoomsReading,
  RoomsPage,
  "partition" | "apply" | "refresh"
>({
  key: "rooms",
  name: "Rooms",
  docs: "Split the zones drawn on one level's plan view into room regions, stage each room's name, type and Manual J fields, then apply them to the regions in Revit.",
  needs: "project",
  work: roomsRouteState,
  cells: {
    segment: "edits",
    groupOf: (key: string) => [roomEditAddress(key).guid],
    nouns: ["room"],
  },
  readings: { receipts: { kind: "receipts", target: { session: "", openId: "" } } } as never,
  page: roomsPageSchema,
  stages: ROOMS_STAGES,
  actions: {
    partition: {
      label: "partition",
      does: "rooms.partition",
      input: none,
      dirties: ["receipts"],
      stage: "partition",
      waitSeconds: NATIVE_APPLY_WAIT_S,
      ready: (ctx) => (ctx.page.view ? null : "Pick a plan view"),
      run: async (ctx) => {
        // The action's result is the op's response, as the generated catalog declares it.
        const result = (await dispatch(ctx, "rooms.partition", {
          view: ctx.page.view,
        })) as RoomsPartition.Res.Response;
        ctx.note(
          "partition",
          `${result.zones} zones · ${result.created} created · ${result.kept} kept · ${result.locked} locked · ${result.deleted} deleted · ${result.held} held`,
          result.failures.length > 0,
        );
        bump(ctx);
      },
    },
    apply: {
      label: "apply",
      labelNow: (ctx) => {
        const n = stagedKeys(ctx).length;
        return n ? `apply ${n} cell${n === 1 ? "" : "s"}` : "apply";
      },
      does: "rooms.write",
      input: none,
      dirties: ["receipts"],
      stage: "review",
      waitSeconds: NATIVE_APPLY_WAIT_S,
      requires: { work: true },
      count: (ctx) => stagedKeys(ctx).length || null,
      ready: (ctx) => (stagedKeys(ctx).length ? null : "Nothing staged"),
      run: async (ctx) => {
        const doc = ctx.work.doc;
        if (!doc) throw Error("the Work is not read yet");
        const written = stagedKeys(ctx);
        await dispatch(ctx, "rooms.write", { regions: stagedRoomWrites(doc) });
        // The staged cells are in Revit now; the snapshot is their home.
        const refusal = await ctx.write(
          written.flatMap(([key, cell]) =>
            transitionPatches(["edits"], key, cell, { kind: "unstage" }),
          ),
        );
        bump(ctx);
        return refusal;
      },
    },
    refresh: {
      label: "refresh",
      says: "Reads the rooms snapshot again",
      needs: "project",
      actor: "any",
      input: none,
      dirties: [],
      rereads: "work",
      ready: () => null,
      run: async (ctx) => bump(ctx),
    },
  },
});
