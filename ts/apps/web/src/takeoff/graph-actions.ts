import { z } from "zod";
import {
  commands,
  roomEditSchema,
  routeStatePatchSchema,
  stagedAdoptChoices,
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffEditPatches,
  takeoffFlagToggle,
  transitionPatches,
  type TakeoffsRouteDocument,
  type TakeoffObservation,
  type TakeoffCapture,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { commandVerb, queryVerb, workVerb } from "#/shell/verbs";
import type { BindingScope, MountBinding } from "#/shell/mount-owner";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { snapshotOfObservation, syncPlan } from "./actions";
import { roomEdit, withEditBases } from "./projections";
import { readZoneMeta } from "./world";
import { decisionRefusal } from "./room-actions";
import type { TakeoffGraphPage } from "./graph";

export type TakeoffScope = BindingScope<TakeoffGraphPage, TakeoffsRouteDocument>;
export const valueOf = <T>(scope: TakeoffScope, id: string): T | undefined =>
  (scope.readings[id]?.value ?? scope.readings[id]?.previous) as T | undefined;
export const captureOf = (scope: TakeoffScope): TakeoffCapture | undefined => {
  if (scope.page.work) return valueOf(scope, "saved");
  const observation = valueOf<TakeoffObservation>(scope, "snapshot");
  return observation?.kind === "ready"
    ? observation.capture
    : observation && "previous" in observation
      ? observation.previous
      : undefined;
};
export const takeoffRefusal = (scope: TakeoffScope, current = false): string | null => {
  // TODO: kernel capture custody must close Work even when its original document is open.
  if (scope.page.work) return "Saved captures are read-only; return to the live document to act";
  if (scope.target.kind !== "document") return "Choose an open document first";
  if (!scope.work) return "Work has not been read yet";
  if (
    current &&
    (!scope.readings.snapshot?.current ||
      valueOf<TakeoffObservation>(scope, "snapshot")?.kind !== "ready")
  )
    return "Read the current document first";
  return null;
};
const refusal = z.string().nullable().default(null);
const guarded = <S extends z.ZodType>(request: S) => z.strictObject({ request, refusal });
const patches = z.strictObject({
  patches: z.array(routeStatePatchSchema),
  expectedRevision: z.number().int(),
  refusal,
});
export const takeoffVerbs = {
  edit: workVerb(
    { label: "Edit takeoff cells", input: patches },
    {
      ready: (scope, input) =>
        input.refusal ??
        (scope.snapshot.work?.handle.revision === input.expectedRevision
          ? null
          : "Work changed; edit the current takeoff cells"),
      patches: (_, input) => input.patches,
    },
  ),
  room: workVerb(
    {
      label: "Edit room",
      input: guarded(z.object({ id: z.string(), next: roomEditSchema, base: roomEditSchema })),
    },
    {
      ready: (_, input) => input.refusal,
      patches: (scope, { request }) =>
        takeoffEditPatches(
          scope.snapshot.work!.doc as TakeoffsRouteDocument,
          request.id,
          request.base,
          request.next,
        ),
    },
  ),
  adoption: workVerb(
    {
      label: "Edit adoption",
      input: guarded(
        z.object({
          key: z.string(),
          choice: z.object({ checked: z.boolean(), name: z.string(), systemTag: z.string() }),
        }),
      ),
    },
    {
      ready: (_, input) => input.refusal,
      patches: (scope, { request }) =>
        transitionPatches(
          ["adopt"],
          request.key,
          (scope.snapshot.work!.doc as TakeoffsRouteDocument).adopt[request.key] ?? {},
          { kind: "set", rung: { value: request.choice } },
        ),
    },
  ),
  decide: workVerb(
    {
      label: "Decide room call",
      input: guarded(
        z.object({ room: z.string(), flag: z.string(), verdict: z.enum(["accept", "dismiss"]) }),
      ),
    },
    {
      ready: (_, input) => input.refusal,
      patches: (scope, { request }) => {
        const key = takeoffDecisionKey(request.room, request.flag);
        return transitionPatches(
          ["decisions"],
          key,
          (scope.snapshot.work!.doc as TakeoffsRouteDocument).decisions[key] ?? {},
          { kind: "set", rung: { value: request.verdict } },
        );
      },
    },
  ),
  flag: workVerb(
    {
      label: "Flag review shape",
      input: guarded(z.object({ zone: z.string(), shape: z.string() })),
    },
    {
      ready: (_, input) => input.refusal,
      patches: (scope, { request }) =>
        takeoffFlagToggle(
          scope.snapshot.work!.doc as TakeoffsRouteDocument,
          request.zone,
          request.shape,
        ),
    },
  ),
  initialize: commandVerb(
    "takeoffs.initialize",
    { label: "initialize", review: "none", input: guarded(commands["takeoffs.initialize"].input) },
    {
      ready: (_, input) => input.refusal,
      intent: (_, input) => input.request,
      waitSeconds: NATIVE_APPLY_WAIT_S,
    },
  ),
  adopt: commandVerb(
    "takeoffs.adopt",
    {
      label: "adopt",
      chord: "Mod+Shift+A",
      review: "none",
      input: guarded(commands["takeoffs.adopt"].input),
    },
    {
      ready: (_, input) => input.refusal,
      intent: (_, input) => input.request,
      waitSeconds: NATIVE_APPLY_WAIT_S,
    },
  ),
  partition: commandVerb(
    "takeoffs.partition",
    { label: "partition", review: "none", input: guarded(commands["takeoffs.partition"].input) },
    {
      ready: (_, input) => input.refusal,
      intent: (_, input) => input.request,
      waitSeconds: NATIVE_APPLY_WAIT_S,
    },
  ),
  refresh: queryVerb(
    "takeoffs.snapshot",
    { label: "refresh", chord: "Mod+R", review: "none", input: guarded(z.strictObject({})) },
    { ready: (_, input) => input.refusal, intent: (_, input) => input.request },
  ),
  "retry-r10": queryVerb(
    "rhvac.open",
    { label: "retry .r10", review: "none", input: guarded(z.object({ path: z.string().min(1) })) },
    { ready: (_, input) => input.refusal, intent: (_, input) => input.request },
  ),
  sync: commandVerb(
    "takeoffs.sync",
    {
      label: "sync",
      review: "shown",
      input: guarded(
        z.object({
          path: z.string().min(1),
          zones: z.array(z.string()),
          captureId: z.string(),
          fileVersion: z.string(),
          plan: z.unknown(),
        }),
      ),
    },
    {
      ready: (_, input) => input.refusal,
      prepare: (scope, input) => ({
        ...input.request,
        work: scope.snapshot.work?.handle,
        target: scope.snapshot.target,
      }),
      intent: (_, { request }) => ({
        path: request.path,
        zones: request.zones,
        captureId: request.captureId,
        fileVersion: request.fileVersion,
      }),
      waitSeconds: NATIVE_APPLY_WAIT_S,
    },
  ),
  // TODO: shell needs an admitted host-RPC command door for rhvac.launch, absent from commands.
  launch: {
    kind: "command",
    does: "rhvac.launch",
    label: "open in RHVAC",
    review: "none",
    input: z.strictObject({}),
  } as const,
};

export function takeoffBinding(id: string, row: unknown, scope: TakeoffScope): MountBinding {
  const input = (row ?? {}) as Partial<{
    patches: RouteStatePatch[];
    expectedRevision: number;
    id: string;
    room: string;
    flag: string;
    zone: string;
  }>;
  const snapshot = snapshotOfObservation(valueOf(scope, "snapshot"));
  const world = snapshot?.world;
  const common = takeoffRefusal(scope);
  let request: unknown = input;
  let why = common;
  if (id === "edit") {
    const edited =
      scope.work && world
        ? withEditBases(scope.work.doc, world, input.patches ?? [])
        : (input.patches ?? []);
    return {
      subject: null,
      args: {
        ...input,
        expectedRevision: input.expectedRevision ?? -1,
        patches: edited,
        refusal: common ?? (row ? null : "Choose a cell to edit"),
      },
    };
  }
  if (id === "room") {
    const room = world?.zones.flatMap((zone) => zone.rooms).find((room) => room.guid === input.id);
    request = { ...input, base: room ? roomEdit(room) : {} };
    why ??= !room ? "Read the room before editing it" : null;
  }
  if (id === "adoption") request = input;
  if (id === "decide") {
    const room = world?.zones
      .flatMap((zone) => zone.rooms)
      .find((room) => room.guid === input.room);
    why ??=
      room && input.flag ? decisionRefusal(room, input.flag) : "Read the room before deciding";
  }
  if (id === "flag") request = input;
  if (id === "initialize") {
    request = { stage: snapshot?.carriers.stage ?? "Adoption" };
    why =
      takeoffRefusal(scope, true) ??
      (snapshot?.carriers.status === "needs-initialization"
        ? null
        : "The document already carries every shared parameter");
  }
  if (id === "adopt") {
    const choices = scope.work ? stagedAdoptChoices(scope.work.doc) : {};
    const grouped = new Map<string, { elementId: number; name: string; systemTag: string }[]>();
    const add = (view: string, item: { elementId: number; name: string; systemTag: string }) =>
      grouped.set(view, [...(grouped.get(view) ?? []), item]);
    for (const [key, choice] of Object.entries(choices)) {
      const cut = key.lastIndexOf(":");
      const view = key.slice(0, cut);
      if (choice.checked && scope.page.views.includes(view))
        add(view, {
          elementId: Number(key.slice(cut + 1)),
          name: choice.name || `${view} · ${key.slice(cut + 1)}`,
          systemTag: choice.systemTag ?? "",
        });
    }
    for (const region of snapshot?.zoneFrs ?? []) {
      if (
        region.role !== "zoning-region" ||
        !scope.page.views.includes(region.view) ||
        `${region.view}:${region.elementId}` in choices
      )
        continue;
      const meta = readZoneMeta(region.blob);
      add(region.view, {
        elementId: region.elementId,
        name: meta.name || region.typeName || `${region.view} · ${region.elementId}`,
        systemTag: meta.systemTag,
      });
    }
    request = { views: [...grouped].map(([view, items]) => ({ view, items })) };
    why = takeoffRefusal(scope, true) ?? (grouped.size ? null : "Select regions to adopt");
  }
  if (id === "partition") {
    const ids = input.zone ? [input.zone] : scope.page.zones;
    const zone = world?.zones.find((zone) => zone.zone.guid === ids[0]);
    request = {
      zoneGuid: ids[0] ?? "",
      zoneRegion: zone?.zone.elementId ?? 0,
      view: zone?.zone.lane.view ?? "",
      zoneName: zone?.name ?? "",
    };
    // TODO: kernel sequential command presses must stop after the first failed zone receipt.
    why =
      takeoffRefusal(scope, true) ??
      (ids.length > 1
        ? "Partition one zone at a time; the kernel cannot yet sequence zone commands"
        : !ids.length
          ? "Select zones to partition"
          : !zone || zone.zone.elementId === null
            ? "Refresh the selected adopted zones"
            : null);
  }
  if (id === "refresh") request = {};
  if (id === "retry-r10") {
    request = { path: scope.page.r10 };
    why ??= scope.page.r10 ? null : "Choose an .r10 file";
  }
  if (id === "sync") {
    const capture = captureOf(scope);
    const version = valueOf<{ path: string; fileVersion: string }>(scope, "rhvacVersion");
    const plan =
      world && scope.work
        ? syncPlan(
            world,
            scope.page.zones,
            stagedTakeoffEdits(scope.work.doc),
            stagedDecisions(scope.work.doc),
          )
        : null;
    request = {
      path: scope.page.r10,
      zones: [...scope.page.zones],
      captureId: capture?.id ?? "",
      fileVersion: version?.fileVersion ?? "",
      plan,
    };
    why =
      takeoffRefusal(scope, true) ??
      (!scope.page.r10
        ? "Choose an .r10 file"
        : !scope.readings.rhvacVersion?.current || version?.path !== scope.page.r10
          ? "Read the current RHVAC file before reviewing"
          : plan?.blockedZones.length
            ? `${plan.blockedZones.length} selected zones are not ready to sync`
            : plan?.untagged
              ? "Tag the eligible zones before syncing"
              : !plan?.inserts.length && !plan?.linkedUpdates
                ? "No eligible inserts or linked edit updates"
                : null);
  }
  return { subject: null, args: id === "launch" ? {} : { request, refusal: why } };
}
