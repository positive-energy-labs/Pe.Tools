import type { z } from "zod";
import { lifetime } from "./family-actions.ts";
import type { CommandContext, CommandFactory } from "./command-executor.ts";
import { preparedTakeoffSchema } from "@pe/agent-contracts";
import { type NativeProcess, type SdkReceiptReader } from "./native-receipts.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  commands,
  commandTool,
  editableCells,
  takeoffCaptureSchema,
  type Consumed,
  type WorkHandle,
  takeoffActions,
  sameAddress,
  type TakeoffActionKey,
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffEditKey,
  takeoffsRouteState,
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
import { BridgeError, type RevitBridge } from "./bridge.ts";
import type { ActionExecution } from "./action-journal.ts";
import { type TakeoffCaptures } from "./takeoff-captures.ts";
import { rhvacOpen, rhvacSync } from "./rhvac-ops.ts";

let workspace: RouteWorkspace | undefined;
export const actionWorkspace = () => workspace;
export const bindActionWorkspace = (value: RouteWorkspace) => {
  workspace = value;
};
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

const takeoffInput = <K extends TakeoffActionKey>(
  _key: K,
  input: unknown,
): z.infer<(typeof takeoffActions)[K]["input"]> =>
  input as z.infer<(typeof takeoffActions)[K]["input"]>;
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });

const preparedSyncSchema = preparedTakeoffSchema.extend({
  capture: takeoffCaptureSchema.optional(),
});

export function takeoffExecutors(
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
) {
  return Object.fromEntries(
    Object.keys(takeoffActions).map((name) => [
      name,
      async (ctx: CommandContext) => {
        const { admission } = ctx;
        const key = name as TakeoffActionKey;
        const definition = commands[key];
        const {
          work: workInput,
          captureId: _capture,
          fileVersion: _version,
          ...operationInput
        } = admission.input;
        if (admission.target.kind !== "document") throw refused("Exact document target required");
        const target = admission.target.ref;
        const work = deps.workspace ?? ctx.work ?? workspace;
        const base = workInput as WorkHandle | undefined;
        let process: NativeProcess;
        let capture: import("@pe/agent-contracts").TakeoffCapture | undefined;
        let submitted:
          | {
              edits: Record<string, StagedRoomEdit>;
              decisions: Record<string, "accept" | "dismiss">;
            }
          | undefined;
        return {
          definition,
          prepared: preparedSyncSchema,
          bind: async () => {
            const lifetimeRead = await lifetime(bridge, target, "project", deps);
            process = lifetimeRead.process;
            const document = lifetimeRead.session.state!.openDocuments.find(
              (doc) => doc.openId === target.openId,
            )!;
            const consumes: Consumed[] = [
              { kind: "incarnation", target: admission.target, process },
            ];
            if (base) {
              if (
                base.key.target &&
                (!document.address || !sameAddress(base.key.target, document.address as never))
              )
                throw refused("Work belongs to a different document");
              const view = await ctx.read.work(base, base.key.route);
              if (base.key.route === "takeoffs") {
                const doc = takeoffsRouteState.schema.parse(view.doc);
                submitted = { edits: stagedTakeoffEdits(doc), decisions: stagedDecisions(doc) };
                consumes.push({
                  kind: "work",
                  handle: base,
                  paths: [
                    ...Object.entries(doc.edits).flatMap(([key, cell]) =>
                      cell.edit ? [["edits", key, "edit"]] : [],
                    ),
                    ...Object.entries(doc.decisions).flatMap(([key, cell]) =>
                      cell.edit ? [["decisions", key, "edit"]] : [],
                    ),
                    ...Object.keys(submitted.edits).map((room) => ["bases", room]),
                  ],
                  snapshot: doc,
                });
              } else
                consumes.push({
                  kind: "work",
                  handle: base,
                  paths: editableCells(view.doc, commandTool(key)?.work?.editable ?? []).flatMap(
                    ({ path, cell }) => (cell.edit ? [[...path, "edit"]] : []),
                  ),
                  snapshot: view.doc,
                });
            }
            const captureId = admission.input.captureId as string | undefined;
            capture = captureId ? await captures.saved(captureId) : undefined;
            if (capture) {
              if (
                capture.provenance.kind !== "live" ||
                capture.provenance.target.session !== target.session ||
                capture.provenance.target.openId !== target.openId
              )
                throw refused("Capture is not evidence for the admitted lifetime");
              const artifact = await captures.savedText(capture.id);
              consumes.push({
                kind: "file",
                path: artifact.path,
                sha256: createHash("sha256").update(artifact.text).digest("hex"),
              });
            }
            const effects: import("@pe/agent-contracts").Footprint = [
              { kind: "document", ref: target },
            ];
            if (key === "takeoffs.sync") {
              if (!capture) throw refused("Sync requires its reviewed captureId");
              if (typeof admission.input.fileVersion !== "string")
                throw refused("Sync requires its reviewed fileVersion");
              consumes.push({
                kind: "file",
                path: String(admission.input.path),
                sha256: admission.input.fileVersion,
              });
              effects.push({ kind: "file", path: String(admission.input.path) });
            }
            return { consumes, effects };
          },
          prepare: async () => ({
            process,
            edits: submitted?.edits ?? {},
            decisions: submitted?.decisions ?? {},
            ...(capture ? { capture } : {}),
          }),
          run: async (_ctx: CommandContext, execution: ActionExecution) => {
            const frozen = execution.prepared as z.infer<typeof preparedSyncSchema>;
            const submitted = { edits: frozen.edits, decisions: frozen.decisions };
            const capture = frozen.capture;
            const native = <A = unknown>(key: string, input: unknown) =>
              execution.step(
                "native",
                key,
                input,
                async (requestId) => {
                  const outcome = await Effect.runPromise(
                    Effect.result(
                      bridge.invoke(key, input, target.session, target.openId, requestId),
                    ),
                  );
                  if (outcome._tag === "Failure") throw outcome.failure;
                  return outcome.success.value as A;
                },
                frozen.process,
              );
            const prepare = async (stage: string) => {
              let remaining = Infinity;
              while (remaining > 0) {
                const result = await native<{ remaining: string[] }>(
                  "takeoffs.initialize-carrier",
                  {
                    stage,
                  },
                );
                if (!Array.isArray(result.remaining) || result.remaining.length >= remaining)
                  throw Error("Carrier preparation made no progress");
                remaining = result.remaining.length;
              }
            };
            if (definition.dirties.includes("snapshot")) captures.invalidate(target);
            try {
              if (key === "takeoffs.initialize") {
                const input = takeoffInput(key, operationInput);
                await prepare(input.stage);
                return { text: `wrote the shared parameters for ${input.stage}` };
              }
              if (key === "takeoffs.adopt") {
                const input = takeoffInput(key, operationInput);
                await prepare("Adoption");
                const results = [];
                for (const view of input.views)
                  results.push(await native<{ adopted: unknown[] }>(key, view));
                return {
                  adopted: results.reduce((sum, result) => sum + result.adopted.length, 0),
                  text: `adopted ${results.reduce((sum, result) => sum + result.adopted.length, 0)} zoning regions`,
                };
              }
              if (key === "takeoffs.partition") {
                await prepare("Materialization");
                const value = await native(key, { ...operationInput, runId: admission.id });
                return { value, target: { session: target.session, document: null } };
              }
              if (key === "rooms.partition") {
                await prepare("Rooms");
                const value = await native(key, { ...operationInput, runId: admission.id });
                return { value, target: { session: target.session, document: null } };
              }
              if (key === "rooms.draw" || key === "rooms.write" || key === "rooms.merge") {
                await prepare("Rooms");
                const value = await native(key, operationInput);
                return { value, target: { session: target.session, document: null } };
              }
              const input = takeoffInput("takeoffs.sync", operationInput);
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
                        Effect.runPromise(
                          rhvacOpen({ path }).pipe(Effect.provide(NodeServices.layer)),
                        ))
                    )(input.path);
                    const firstRoomNumber =
                      Math.max(0, ...before.rooms.map((room) => room.number)) + 1;
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
                    let nextSystem =
                      Math.max(0, ...before.systems.map((system) => system.number)) + 1;
                    const systems = new Map<string, number>();
                    for (const { zone } of inserts) {
                      const tag = zone.tags[0]!;
                      if (systems.has(tag)) continue;
                      const existing = bySystemName.get(tag.trim().toLocaleLowerCase());
                      if (existing !== undefined) systems.set(tag, existing);
                      else if (firstRun) systems.set(tag, nextSystem++);
                      else
                        throw refused(`system '${tag}' does not exist in this non-first-run .r10`);
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
                            ([, number]) =>
                              !before.systems.some((system) => system.number === number),
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
                undefined,
                async () => [
                  {
                    kind: "file",
                    path: input.path,
                    sha256: await (deps.fileVersion ?? fileVersion)(input.path),
                  },
                ],
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
              if (base && submitted && work) {
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
              if (definition.dirties.includes("snapshot")) captures.invalidate(target);
            }
          },
        };
      },
    ]),
  ) as Record<string, CommandFactory>;
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
