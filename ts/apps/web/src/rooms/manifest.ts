/**
 * The static /rooms contract: split one level's plan view into Room Regions, stage their fields
 * into Work, write the staged cells to Revit. Behavior is here; the page draws it (`route.tsx`).
 */
import { z } from "zod";
import type { RoomsMerge, RoomsPartition } from "@pe/host-contracts/generated";
import {
  roomEditAddress,
  roomsRouteState,
  stagedRoomWrites,
  transitionPatches,
  type Mark,
  type RoomsRouteDocument,
} from "@pe/agent-contracts";

import { defineRoute, semanticActionInput, type Ctx } from "#/route/manifest";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import {
  actionResult,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

const ROOMS_STAGES = [
  { key: "partition", word: "Partitioning rooms" },
  { key: "review", word: "Reviewing rooms" },
  { key: "history", word: "History" },
] as const;

const roomsPageSchema = z.object({
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
  key: "rooms.partition" | "rooms.write" | "rooms.merge",
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
  "partition" | "apply" | "merge" | "applyMark" | "refresh"
>({
  key: "rooms",
  name: "Rooms",
  docs: "Split the zones drawn on one level's plan view into room regions, stage each room's name, type and Manual J fields, then apply them to the regions in Revit.",
  needs: "project",
  work: roomsRouteState,
  cells: [
    { segment: "edits", groupOf: (key) => [roomEditAddress(key).guid], nouns: ["room"] },
    {
      segment: "marks",
      groupOf: (key) => [key],
      nouns: ["mark"],
      noun: "room marks",
      show: (value) => (value as Mark).kind,
    },
  ],
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
        // A person's standing rejections ride every partition of their view.
        const rejected = Object.values(ctx.work.doc?.marks ?? {})
          .map((cell) => cell.staged?.value)
          .filter((mark) => mark?.kind === "reject" && mark.anchor.view === ctx.page.view)
          .map((mark) => mark!.anchor.polygon);
        const result = (await dispatch(ctx, "rooms.partition", {
          view: ctx.page.view,
          ...(rejected.length ? { rejected } : {}),
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
    merge: {
      label: "merge",
      labelNow: (ctx) =>
        ctx.page.selected.length > 1 ? `merge ${ctx.page.selected.length}` : "merge",
      does: "rooms.merge",
      input: none,
      dirties: ["receipts"],
      stage: "review",
      waitSeconds: NATIVE_APPLY_WAIT_S,
      count: (ctx) => (ctx.page.selected.length > 1 ? ctx.page.selected.length : null),
      ready: (ctx) =>
        !ctx.page.view
          ? "Pick a plan view"
          : ctx.page.selected.length < 2
            ? "Shift-click two or more rooms"
            : null,
      run: async (ctx) => {
        // The merged room is locked: every later partition keeps it and redraws only its neighbours.
        const result = (await dispatch(ctx, "rooms.merge", {
          view: ctx.page.view,
          guids: ctx.page.selected,
        })) as RoomsMerge.Res.Response;
        ctx.note("merge", `${result.merged.length} rooms merged · ${result.sqft.toFixed(0)} sf`);
        ctx.setPage({ selected: [result.guid], epoch: ctx.page.epoch + 1 });
      },
    },
    applyMark: {
      label: "apply mark",
      does: "rooms.merge",
      input: z.object({ id: z.string() }) as unknown as z.ZodType<never>,
      dirties: ["receipts"],
      stage: "review",
      visible: false,
      waitSeconds: NATIVE_APPLY_WAIT_S,
      // Without an input this answers for the verb at large (the handle's refusal); a card asks with its id.
      ready: (ctx, input) => {
        const id = (input as { id: string } | undefined)?.id;
        if (id === undefined) return null;
        const mark = ctx.work.doc?.marks[id]?.staged?.value;
        return mark?.kind !== "merge"
          ? "Not a staged merge mark"
          : (mark.guids?.length ?? 0) < 2
            ? "The mark covers fewer than two regions"
            : null;
      },
      run: async (ctx, input) => {
        const { id } = input as { id: string };
        const mark = ctx.work.doc!.marks[id]!.staged!.value!;
        const result = (await dispatch(ctx, "rooms.merge", {
          view: mark.anchor.view,
          guids: mark.guids,
        })) as RoomsMerge.Res.Response;
        ctx.note(
          "merge",
          `${id} · ${result.merged.length} rooms merged · ${result.sqft.toFixed(0)} sf`,
        );
        bump(ctx);
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
