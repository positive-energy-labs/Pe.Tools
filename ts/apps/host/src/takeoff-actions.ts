import { lifetime } from "./family-actions.ts";
import { command, refused, type CommandContext } from "./command-executor.ts";
import { preparedTakeoffSchema } from "@pe/agent-contracts";
import type { NativeProcess, SdkReceiptReader } from "./native-receipts.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  commands,
  tools,
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
  type ModelRoom,
} from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import type {
  RhvacInsertRoomData,
  RhvacExtractData,
  RhvacSyncRequest,
  RhvacSyncResult,
} from "@pe/host-contracts/operation-types";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import type { ActionExecution } from "./action-journal.ts";
import { type TakeoffCaptures } from "./takeoff-captures.ts";
import { rhvacOpen, rhvacSync } from "./rhvac-ops.ts";

export const fileVersion = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
export type TakeoffActionDependencies = {
  workspace?: RouteWorkspace;
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
      (id) => invokeBridge<A>(bridge, modelTarget(ctx), key, input, id),
      { process },
    );
type Native = ReturnType<typeof nativeFor>;

/** The carrier stage is bounded by native remaining work, shared by the seven concrete commands. */
async function runCarrier(
  ctx: CommandContext,
  execution: ActionExecution & { readonly prepared: { process: NativeProcess } },
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  stage: string,
  perform: (native: Native) => Promise<unknown>,
) {
  const target = modelTarget(ctx);
  const native = nativeFor(ctx, execution, bridge, execution.prepared.process);
  captures.invalidate(target);
  try {
    let remaining = Infinity;
    while (remaining > 0) {
      const result = await native<{ remaining: string[] }>("takeoffs.initialize-carrier", {
        stage,
      });
      if (!Array.isArray(result.remaining) || result.remaining.length >= remaining)
        throw Error("Carrier preparation made no progress");
      remaining = result.remaining.length;
    }
    return await perform(native);
  } finally {
    captures.invalidate(target);
  }
}

export function takeoffExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
) {
  const bindCarrier = async (ctx: CommandContext, select?: () => Promise<void>) => {
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
  const value = async (ctx: CommandContext, native: Native, key: string, input: unknown) => ({
    value: await native(key, input),
    target: { session: modelTarget(ctx).session, document: null },
  });
  return {
    "takeoffs.initialize": command(commands["takeoffs.initialize"], preparedCarrierSchema, {
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, ctx.admission.input.stage, async () => ({
          text: `wrote the shared parameters for ${ctx.admission.input.stage}`,
        })),
    }),
    "takeoffs.adopt": command(commands["takeoffs.adopt"], preparedCarrierSchema, {
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Adoption", async (native) => {
          let adopted = 0;
          for (const view of ctx.admission.input.views)
            adopted += (await native<{ adopted: unknown[] }>("takeoffs.adopt", view)).adopted
              .length;
          return { adopted, text: `adopted ${adopted} zoning regions` };
        }),
    }),
    "takeoffs.partition": command(commands["takeoffs.partition"], preparedCarrierSchema, {
      bind: (ctx) => bindCarrier(ctx),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Materialization", (native) =>
          value(ctx, native, "takeoffs.partition", {
            ...ctx.admission.input,
            runId: ctx.admission.id,
          }),
        ),
    }),
    "rooms.partition": command(commands["rooms.partition"], preparedCarrierSchema, {
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
          const { work: _work, ...input } = ctx.admission.input;
          return value(ctx, native, "rooms.partition", { ...input, runId: ctx.admission.id });
        }),
    }),
    "rooms.draw": command(commands["rooms.draw"], preparedCarrierSchema, {
      bind: (ctx) => bindCarrier(ctx, () => selectRooms(ctx, () => [])),
      run: (ctx, execution) =>
        runCarrier(ctx, execution, captures, bridge, "Rooms", (native) => {
          const { work: _work, ...input } = ctx.admission.input;
          return value(ctx, native, "rooms.draw", input);
        }),
    }),
    "rooms.write": command(commands["rooms.write"], preparedCarrierSchema, {
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
    }),
    "rooms.merge": command(commands["rooms.merge"], preparedCarrierSchema, {
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
          const { work: _work, ...input } = ctx.admission.input;
          return value(ctx, native, "rooms.merge", input);
        }),
    }),
    "takeoffs.sync": command(commands["takeoffs.sync"], preparedSyncSchema, {
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
      run: async (ctx, execution) => {
        const { input } = ctx.admission;
        const admission = ctx.admission;
        const target = modelTarget(ctx);
        const base = input.work;
        const frozen = execution.prepared;
        const submitted = { edits: frozen.edits, decisions: frozen.decisions };
        const capture = frozen.capture;
        const native = nativeFor(ctx, execution, bridge, frozen.process);
        captures.invalidate(target);
        try {
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
            : await (async (): Promise<RhvacSyncRequest> => {
                const before = await (
                  deps.openFile ??
                  ((path) =>
                    Effect.runPromise(rhvacOpen({ path }).pipe(Effect.provide(NodeServices.layer))))
                )(input.path);
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
                };
              })();
          const result = await execution.step(
            "file",
            "rhvac.sync",
            { request, expectedVersion: admission.input.fileVersion as string },
            () =>
              (
                deps.syncFile ??
                ((input, expectedVersion) =>
                  Effect.runPromise(
                    rhvacSync(input, expectedVersion).pipe(Effect.provide(NodeServices.layer)),
                  ))
              )(request, admission.input.fileVersion as string),
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
            await native("takeoffs.rhvac-links", recordedLinks?.input ?? { writes });
          }
          let retirement: unknown;
          if (base) {
            const consumed = new Map(
              [...linked, ...inserts.map(({ room }) => room)]
                .filter((room) => edits.has(room.guid))
                .map((room) => [room.guid, edits.get(room.guid)!]),
            );
            retirement = await execution.retireWork(
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
        } finally {
          captures.invalidate(target);
        }
      },
    }),
  };
}

const WALL_ASSEMBLY =
  "R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6 wood stud cavity, R-15 Fiberglass batt";
const ROOF_ASSEMBLY = "R49 closed cell sprayfoam in 2x14 joist cavity";
const FLOOR_ASSEMBLY =
  "R-19 open cell 1/2 lb. spray foam insulation, 5 inches in 2 x 10 joist cavity, any cover";

function buildRhvacInsert(
  room: ModelRoom,
  number: number,
  systemNumber: number,
): RhvacInsertRoomData {
  if (!Number.isFinite(room.ceilingFt) || room.ceilingFt <= 0)
    throw refused(`room '${room.name}' has invalid ceiling height ${room.ceilingFt}`);
  const height = room.ceilingFt;
  const outer = room.outer ?? [];
  const walls = outer.map(([x1, y1], index) => {
    const [x2, y2] = outer[(index + 1) % outer.length]!;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const octant = ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
    return {
      index1: index + 1,
      assembly: WALL_ASSEMBLY,
      uValue: 0.036,
      lengthFeet: Math.hypot(x2 - x1, y2 - y1),
      heightFeet: height,
      direction: octant + 1,
    };
  });
  return {
    number,
    name: room.name,
    systemNumber,
    zoneNumber: 1,
    areaSquareFeet: room.sqft,
    ceilingHeightFeet: height,
    people: room.data!.people,
    lightingWatts: room.data!.lightingW,
    equipmentSensibleBtuh: room.data!.equipSensible,
    equipmentLatentBtuh: room.data!.equipLatent,
    ventilationCfm: room.data!.ventilationCfm,
    floors: [
      {
        assembly: FLOOR_ASSEMBLY,
        uValue: 0.051,
        areaSquareFeet: room.sqft,
        exposedPerimeterFeet: walls.reduce((sum, wall) => sum + wall.lengthFeet, 0),
      },
    ],
    roofs: [
      { assembly: ROOF_ASSEMBLY, uValue: 0.024, areaSquareFeet: room.sqft, areaMultiplier: 1.2 },
    ],
    walls,
    glass: [],
    doors: [],
  };
}

function applyStaged<A extends Record<string, unknown>>(room: A, edit: StagedRoomEdit): A {
  const next = edit.next;
  return {
    ...room,
    ...(next.name === undefined ? {} : { name: next.name }),
    ...(next.ceilingFt === undefined ? {} : { ceilingHeightFeet: next.ceilingFt }),
    ...(next.people === undefined ? {} : { people: next.people }),
    ...(next.lightingW === undefined ? {} : { lightingWatts: next.lightingW }),
    ...(next.equipSensible === undefined ? {} : { equipmentSensibleBtuh: next.equipSensible }),
    ...(next.equipLatent === undefined ? {} : { equipmentLatentBtuh: next.equipLatent }),
    ...(next.ventilationCfm === undefined ? {} : { ventilationCfm: next.ventilationCfm }),
  };
}
