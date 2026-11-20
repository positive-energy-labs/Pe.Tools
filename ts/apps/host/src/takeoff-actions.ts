import { z } from "zod";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";
import { nativeRequestInput } from "./native-input.ts";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import { lifetime } from "./document-lifetime.ts";
import { command, io, nativeStep, refused, type CommandContext } from "@pe/host-internal/command-executor";
import { preparedTakeoffSchema } from "@pe/agent-contracts";
import type { NativeProcess, SdkReceiptReader } from "./native-receipts.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import {
  roomEditAddress,
  takeoffEditAddress,
  takeoffDecisionAddress,
  type RoomsRouteDocument,
  type WorkPath,
  takeoffCaptureSchema,
  type Consumed,
  type WorkHandle,
  sameAddress,
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffEditKey,
  type StagedRoomEdit,
} from "@pe/agent-contracts";
import { commands, tools } from "@pe/mcps/product-actions";
import type { RouteWorkspace } from "@pe/runtime";
import type {
  RhvacExtractData,
  RhvacSyncRequest,
  RhvacSyncResult,
} from "@pe/host-contracts/operation-types";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { ActionExecution, Step } from "@pe/host-internal/action-execution";
import { type TakeoffCaptures } from "./takeoff-captures.ts";
import { applyStaged, buildRhvacInsert, rhvacOpen, rhvacSync } from "./rhvac-ops.ts";

export const fileVersion = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
export type TakeoffActionDependencies = {
  workspace?: RouteWorkspace;
  workReads?: import("./command-executor.ts").CommandResources["workReads"];
  sdk?: SdkReceiptReader;
  fileVersion?: typeof fileVersion;
  openFile?: (path: string) => Promise<RhvacExtractData>;
  syncFile?: (input: RhvacSyncRequest, expectedVersion: string) => Promise<RhvacSyncResult>;
};

const preparedSyncSchema = preparedTakeoffSchema.extend({ capture: takeoffCaptureSchema });
const preparedCarrierSchema = preparedTakeoffSchema.pick({ process: true });
const modelTarget = (ctx: CommandContext) => {
  if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
  return ctx.admission.target.ref;
};
const workHandle = (ctx: CommandContext) => ctx.admission.input.work as WorkHandle | undefined;

async function bindModel(
  ctx: CommandContext,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies,
) {
  const target = modelTarget(ctx);
  const observed = await lifetime(bridge, target, "project", deps);
  const document = observed.session.state!.openDocuments.find(
    (doc) => doc.openId === target.openId,
  )!;
  const handle = workHandle(ctx);
  if (
    handle?.key.target &&
    (!document.address || !sameAddress(handle.key.target, document.address as never))
  )
    throw refused("Work belongs to a different document");
  return { target, process: observed.process };
}

async function selectRooms(
  ctx: CommandContext,
  select: (doc: RoomsRouteDocument, paths: readonly WorkPath[]) => readonly WorkPath[],
) {
  const handle = workHandle(ctx);
  if (handle)
    await ctx.selectWork(tools.rooms.work, handle, (doc, cells) => ({
      cells: select(
        doc,
        cells.map(({ path }) => path),
      ),
    }));
}

const nativeFor =
  (
    ctx: CommandContext,
    execution: ActionExecution,
    bridge: RevitBridge["Service"],
    process: NativeProcess,
  ) =>
  <A = unknown>(key: string, input: unknown) =>
    execution.step(
      "native",
      key,
      input,
      (id) => nativeStep<A>(bridge, modelTarget(ctx), key, input, id),
      { process },
    );
type Native = ReturnType<typeof nativeFor>;

/** The carrier stage is bounded by native remaining work, shared by the seven concrete commands. */
const runCarrier = (
  ctx: CommandContext,
  execution: ActionExecution & { readonly prepared: { process: NativeProcess } },
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  stage: string,
  perform: (native: Native) => Step<unknown>,
) => {
  const target = modelTarget(ctx);
  const native = nativeFor(ctx, execution, bridge, execution.prepared.process);
  return Effect.gen(function* () {
    captures.invalidate(target);
    let remaining = Infinity;
    while (remaining > 0) {
      const result = yield* native<{ remaining: string[] }>("takeoffs.initialize-carrier", {
        stage,
      });
      if (!Array.isArray(result.remaining) || result.remaining.length >= remaining)
        throw Error("Carrier preparation made no progress");
      remaining = result.remaining.length;
    }
    return yield* perform(native);
  }).pipe(Effect.ensuring(Effect.sync(() => captures.invalidate(target))));
};

export function takeoffExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
) {
  const bindCarrier = async (ctx: CommandContext, select?: () => Promise<void>) => {
    // Validate the final leaf before carrier preparation can make its first model write.
    const action = ctx.admission.key.replace(/\.preview$/, "");
    const input = nativeRequestInput(ctx.admission.input);
    const leaf = action === "takeoffs.initialize" ? "takeoffs.initialize-carrier" : action;
    const requests = action === "takeoffs.adopt" ? z.array(z.unknown()).parse(input.views) : [
      action.endsWith(".partition") ? { ...input, runId: ctx.admission.id } : input,
    ];
    for (const request of requests) {
      const checked = nativeRequestSchema(leaf as HostOperationKey).safeParse(request);
      if (!checked.success) throw refused(`Invalid native input for '${leaf}': ${checked.error.message}`, "native.input");
    }
    const { target, process } = await bindModel(ctx, bridge, deps);
    await select?.();
    return {
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
      ],
      effects: [{ kind: "document" as const, ref: target }],
      prepare: async () => ({ process }),
    };
  };
  const value = (ctx: CommandContext, native: Native, key: string, input: unknown) =>
    Effect.map(native(key, input), (value) => ({
      value,
      target: { session: modelTarget(ctx).session, document: null },
    }));
  return {
    "takeoffs.initialize": command(commands["takeoffs.initialize"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, ctx.admission.input.stage, () =>
          Effect.succeed({ text: `wrote the shared parameters for ${ctx.admission.input.stage}` }),
        ),
    }),
    "takeoffs.adopt": command(commands["takeoffs.adopt"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Adoption", (native) =>
          Effect.gen(function* () {
            let adopted = 0;
            for (const view of ctx.admission.input.views)
              adopted += (yield* native<{ adopted: unknown[] }>("takeoffs.adopt", view)).adopted
                .length;
            return { adopted, text: `adopted ${adopted} zoning regions` };
          }),
        ),
    }),
    "takeoffs.partition": command(commands["takeoffs.partition"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Materialization", (native) => {
          return value(ctx, native, "takeoffs.partition", {
            ...nativeRequestInput(ctx.admission.input),
            runId: ctx.admission.id,
          });
        }),
    }),
    "rooms.partition": command(commands["rooms.partition"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) =>
        bindCarrier(ctx, () =>
          selectRooms(ctx, (doc, paths) =>
            paths.filter((path) => {
              const mark =
                path[0] === "marks" ? doc.marks[String(path[1])]?.edit?.value : undefined;
              return mark?.kind === "reject" && mark.anchor.view === ctx.admission.input.view;
            }),
          ),
        ),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Rooms", (native) => {
          return value(ctx, native, "rooms.partition", { ...nativeRequestInput(ctx.admission.input), runId: ctx.admission.id });
        }),
    }),
    "rooms.draw": command(commands["rooms.draw"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) => bindCarrier(ctx, () => selectRooms(ctx, () => [])),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Rooms", (native) => {
          return value(ctx, native, "rooms.draw", nativeRequestInput(ctx.admission.input));
        }),
    }),
    // TODO: docs/features/routes/LEDGER.md#s7-1cd8580b01 rooms.write native receipts report only a count; retain edits until receipts identify confirmed guid/field cells.
    "rooms.write": command(
      {
        ...commands["rooms.write"],
        authoredInput: commands["rooms.write"].authoredInput.extend({
          regions: z.array(z.object({ guid: z.string() }).passthrough()),
        }),
      },
      preparedCarrierSchema,
      {
        seal: (p) => ({ request: { process: p.process } }),
        bind: (ctx) =>
          bindCarrier(ctx, () =>
            selectRooms(ctx, (_doc, paths) =>
              paths.filter((path) => {
                if (path[0] !== "edits") return false;
                const { guid, field } = roomEditAddress(String(path[1]));
                return ctx.admission.input.regions.some(
                  (region) => region.guid === guid && region[field] !== undefined,
                );
              }),
            ),
          ),
        run: (ctx, execution) =>
          runCarrier(ctx, execution, captures, bridge, "Rooms", (native) =>
            value(ctx, native, "rooms.write", { regions: ctx.admission.input.regions }),
          ),
      },
    ),
    "rooms.merge": command(commands["rooms.merge"], preparedCarrierSchema, {
      seal: (p) => ({ request: { process: p.process } }),
      bind: (ctx) =>
        bindCarrier(ctx, () =>
          selectRooms(ctx, (doc, paths) =>
            paths.filter((path) => {
              const mark =
                path[0] === "marks" ? doc.marks[String(path[1])]?.edit?.value : undefined;
              return (
                mark?.kind === "merge" &&
                mark.anchor.view === ctx.admission.input.view &&
                !!mark.guids?.some((guid) => ctx.admission.input.guids.includes(guid))
              );
            }),
          ),
        ),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Rooms", (native) => {
          return value(ctx, native, "rooms.merge", nativeRequestInput(ctx.admission.input));
        }),
    }),
    "takeoffs.sync": command(commands["takeoffs.sync"], preparedSyncSchema, {
      seal: (p) => ({ request: { process: p.process, edits: p.edits, decisions: p.decisions, capture: p.capture.id } }),
      bind: async (ctx) => {
        const { target, process } = await bindModel(ctx, bridge, deps);
        const { input } = ctx.admission;
        const capture = await captures.saved(input.captureId);
        if (
          capture.provenance.kind !== "live" ||
          capture.provenance.target.session !== target.session ||
          capture.provenance.target.openId !== target.openId
        )
          throw refused("Capture is not evidence for the admitted lifetime");
        const artifact = await captures.savedText(capture.id);
        const consumes: Consumed[] = [
          { kind: "incarnation", probe: { target: ctx.admission.target, process }, expected: true },
          {
            kind: "file",
            probe: { path: artifact.path },
            expected: createHash("sha256").update(artifact.text).digest("hex"),
          },
          { kind: "file", probe: { path: input.path }, expected: input.fileVersion },
        ];
        let edits: Record<string, StagedRoomEdit> = {},
          decisions: Record<string, "accept" | "dismiss"> = {};
        const base = input.work;
        if (base) {
          const rooms = new Set(
            capture.snapshot.world.zones
              .filter((zone) => !input.zones.length || input.zones.includes(zone.zone.guid))
              .flatMap((zone) => zone.rooms.map((room) => room.guid)),
          );
          const doc = await ctx.selectWork(tools.takeoffs.work, base, (_doc, cells) => {
            const selected = cells.filter(({ path }) =>
              path[0] === "edits"
                ? rooms.has(takeoffEditAddress(String(path[1])).roomId)
                : path[0] === "decisions" &&
                  rooms.has(takeoffDecisionAddress(String(path[1])).roomGuid),
            );
            const edited = new Set(
              selected
                .filter(({ path }) => path[0] === "edits")
                .map(({ path }) => takeoffEditAddress(String(path[1])).roomId),
            );
            return {
              cells: selected.map(({ path }) => path),
              facts: [...edited].map((room) => ["bases", room] as const),
            };
          });
          edits = Object.fromEntries(
            Object.entries(stagedTakeoffEdits(doc)).filter(([room]) => rooms.has(room)),
          );
          decisions = Object.fromEntries(
            Object.entries(stagedDecisions(doc)).filter(([key]) =>
              rooms.has(takeoffDecisionAddress(key).roomGuid),
            ),
          );
        }
        return {
          consumes,
          effects: [
            { kind: "document", ref: target },
            { kind: "file", path: input.path },
          ],
          prepare: async () => ({ process, edits, decisions, capture }),
        };
      },
      run: (ctx, execution) => {
        const { input } = ctx.admission;
        const target = modelTarget(ctx);
        const base = input.work;
        const { process, edits: stagedEdits, decisions, capture } = execution.prepared;
        const submitted = { edits: stagedEdits, decisions };
        const native = nativeFor(ctx, execution, bridge, process);
        return Effect.gen(function* () {
          captures.invalidate(target);
          const selected = new Set(input.zones);
          const zones = capture!.snapshot.world.zones.filter(
            (zone) => !selected.size || selected.has(zone.zone.guid),
          );
          const edits = new Map(Object.entries(submitted?.edits ?? {}));
          const blocked = zones.filter(
            (zone) =>
              zone.driftSqft === null ||
              zone.driftSqft > 0 ||
              zone.rooms.some(
                (room) =>
                  room.analysis?.state !== "current" ||
                  room.analysis.hold !== null ||
                  room.flags.some(
                    (flag) =>
                      submitted?.decisions[takeoffDecisionKey(room.guid, flag)] === undefined,
                  ),
              ) ||
              zone.runs.some((run) => run.orphaned > 0 || run.failures > 0),
          );
          if (blocked.length)
            throw refused(`${blocked.length} selected zones are not ready to sync`);
          const inserts = zones.flatMap((zone) =>
            zone.rooms
              .filter((room) => room.elementId !== null && !room.r10 && room.data !== null)
              .map((room) => ({ zone, room })),
          );
          const linked = zones
            .flatMap((zone) => zone.rooms)
            .filter((room) => room.r10 && edits.has(room.guid));
          if (!inserts.length && !linked.length)
            throw refused("No eligible inserts or linked staged updates");
          if (inserts.some(({ zone }) => !zone.tags[0]))
            throw refused("Every inserted room requires a system tag");
          const recordedFile = execution.recorded("file", "rhvac.sync");
          const request: RhvacSyncRequest = recordedFile
            ? (recordedFile.input as { request: RhvacSyncRequest }).request
            : yield* Effect.gen(function* () {
                const openFile = deps.openFile;
                const before = openFile
                  ? yield* io(() => openFile(input.path))
                  : yield* rhvacOpen({ path: input.path });
                const firstRoomNumber = Math.max(0, ...before.rooms.map((room) => room.number)) + 1;
                const bySystemName = new Map(
                  before.systems
                    .filter((system) => system.name.trim())
                    .map((system) => [system.name.trim().toLocaleLowerCase(), system.number]),
                );
                const firstRun =
                  before.rooms.length === 1 &&
                  before.rooms[0]!.number === 1 &&
                  !before.rooms[0]!.name.trim() &&
                  before.rooms[0]!.areaSquareFeet === 0;
                let nextSystem = Math.max(0, ...before.systems.map((system) => system.number)) + 1;
                const systems = new Map<string, number>();
                for (const { zone } of inserts) {
                  const tag = zone.tags[0]!;
                  if (systems.has(tag)) continue;
                  const existing = bySystemName.get(tag.trim().toLocaleLowerCase());
                  if (existing !== undefined) systems.set(tag, existing);
                  else if (firstRun) systems.set(tag, nextSystem++);
                  else throw refused(`system '${tag}' does not exist in this non-first-run .r10`);
                }
                const fileRooms = new Map(before.rooms.map((room) => [room.identifier, room]));
                const updates = linked.map((room) => {
                  const current = fileRooms.get(room.r10!.identifier);
                  if (!current)
                    throw refused(`Linked .r10 room ${room.r10!.identifier} no longer exists`);
                  return applyStaged(current, edits.get(room.guid)!);
                });
                return {
                  targetPath: input.path,
                  updates,
                  inserts: inserts.map(({ zone, room }, index) =>
                    edits.has(room.guid)
                      ? applyStaged(
                          buildRhvacInsert(
                            room,
                            firstRoomNumber + index,
                            systems.get(zone.tags[0]!)!,
                          ),
                          edits.get(room.guid)!,
                        )
                      : buildRhvacInsert(
                          room,
                          firstRoomNumber + index,
                          systems.get(zone.tags[0]!)!,
                        ),
                  ),
                  systems: [
                    ...before.systems.map((system) => ({
                      number: system.number,
                      name: system.name,
                    })),
                    ...[...systems]
                      .filter(
                        ([, number]) => !before.systems.some((system) => system.number === number),
                      )
                      .map(([name, number]) => ({ name, number })),
                  ],
                  deleteUntouchedSeedRoom: inserts.length > 0,
                } satisfies RhvacSyncRequest;
              });
          const syncFile = deps.syncFile;
          const expectedVersion = input.fileVersion as string;
          const result = yield* execution.step(
            "file",
            "rhvac.sync",
            { request, expectedVersion },
            () =>
              syncFile
                ? io(() => syncFile(request, expectedVersion))
                : rhvacSync(request, expectedVersion),
          );
          const byNumber = new Map(
            result.insertedRooms.map((room) => [room.number, room.identifier]),
          );
          const fileIdentity = `${result.fileIdentity.fileName}#${result.fileIdentity.stamp}`;
          const writes = inserts.map(({ room }, index) => {
            const identifier = byNumber.get(request.inserts![index]!.number);
            if (identifier === undefined)
              throw Error("RHVAC insertion result omitted a room identity");
            return {
              elementId: room.elementId!,
              link: {
                identifier,
                fileIdentity,
                syncedAt: new Date().toISOString(),
                lastSyncedSqft: room.sqft,
              },
            };
          });
          if (writes.length) {
            const recordedLinks = execution.recorded("native", "takeoffs.rhvac-links");
            yield* native("takeoffs.rhvac-links", recordedLinks?.input ?? { writes });
          }
          let retirement: unknown;
          if (base) {
            const consumed = new Map(
              [...linked, ...inserts.map(({ room }) => room)]
                .filter((room) => edits.has(room.guid))
                .map((room) => [room.guid, edits.get(room.guid)!]),
            );
            retirement = yield* execution.retireWork(
              base.key,
              "takeoffs",
              [...consumed].flatMap(([roomId, edit]) =>
                Object.keys(edit.next).map((field) => [
                  "edits",
                  takeoffEditKey(roomId, field as keyof typeof edit.next),
                ]),
              ),
            );
          }
          return {
            inserted: result.insertedRooms.length,
            updated: result.updated,
            text: `synced ${result.insertedRooms.length} inserted and ${result.updated} updated rooms into ${input.path}`,
            file: result,
            retirement,
          };
        }).pipe(Effect.ensuring(Effect.sync(() => captures.invalidate(target))));
      },
    }),
  };
}
