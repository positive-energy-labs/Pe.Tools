import { preparedTakeoffSchema } from "@pe/agent-contracts";
import {
  readOriginalProcess,
  readNativeReceipt,
  type NativeProcess,
  type SdkReceiptReader,
} from "./native-receipts.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import {
  actionAdmissionSchema,
  takeoffActions,
  sameAddress,
  type TakeoffActionKey,
  stagedDecisions,
  stagedTakeoffEdits,
  takeoffDecisionKey,
  takeoffEditKey,
  takeoffsRouteState,
  transitionPatches,
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
import { type ActionJournal } from "./action-journal.ts";
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
const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });

export async function admitTakeoffAction(
  raw: unknown,
  owner: ActionJournal,
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (!Object.hasOwn(takeoffActions, admission.key))
    throw refused(`Unknown semantic action '${admission.key}'`);
  const key = admission.key as TakeoffActionKey;
  const definition = takeoffActions[key];
  admission.input = definition.input.parse(admission.input);
  if (admission.destination.kind !== "document")
    throw refused(`${key} requires an exact DocumentRef`);
  const target = admission.destination.ref;
  const work = deps.workspace ?? workspace;
  // What an admitted action consumes: the person's staged edits and verdicts, never proposals.
  let submitted:
    | { edits: Record<string, StagedRoomEdit>; decisions: Record<string, "accept" | "dismiss"> }
    | undefined;
  let process: NativeProcess | undefined;
  let capture: Awaited<ReturnType<TakeoffCaptures["saved"]>> | undefined;
  const current = async () => {
    const sessions = await Effect.runPromise(bridge.list);
    const selected = sessions.find((session) => session.sessionId === target.session);
    const document = selected?.state?.openDocuments.find(
      (document) => document.openId === target.openId,
    );
    if (
      process &&
      (selected?.processId !== process.pid ||
        selected?.processStartUtcUnixMs !== Date.parse(process.processStartUtc))
    )
      throw refused("The admitted process incarnation is no longer available");
    if (!document || document.isFamilyDocument)
      throw refused("The admitted project document lifetime is no longer available");
    return document;
  };
  const validate = async () => {
    const document = await current();
    const selected = (await Effect.runPromise(bridge.list)).find(
      (session) => session.sessionId === target.session,
    );
    if (!selected?.processId || selected.processStartUtcUnixMs == null)
      throw refused("Original process identity is unavailable");
    process = await readOriginalProcess(
      selected.processId,
      selected.processStartUtcUnixMs,
      deps.sdk,
    );
    await current();
    if (admission.bases.captureId) {
      capture = await captures.saved(admission.bases.captureId);
      if (
        capture.provenance.kind !== "live" ||
        capture.provenance.target.session !== target.session ||
        capture.provenance.target.openId !== target.openId
      )
        throw refused("Capture is not evidence for the admitted lifetime");
    }
    if (admission.bases.work) {
      if (!work) throw refused("Authored Work storage is unavailable");
      const { key: scope, revision } = admission.bases.work;
      if (
        scope.target &&
        (!document.address || !sameAddress(scope.target, document.address as never))
      )
        throw refused("Work belongs to a different document");
      const view = await work.read(scope, "takeoffs");
      if (!view || view.revision !== revision)
        throw refused("Authored Work changed before action admission");
      const doc = takeoffsRouteState.schema.parse(view.doc);
      submitted = { edits: stagedTakeoffEdits(doc), decisions: stagedDecisions(doc) };
    }
    if (key === "takeoffs.sync") {
      if (!capture) throw refused("Sync requires its reviewed captureId");
      if (!admission.bases.fileVersion) throw refused("Sync requires its reviewed fileVersion");
      if (
        (await (deps.fileVersion ?? fileVersion)(String(admission.input.path))) !==
        admission.bases.fileVersion
      )
        throw refused("RHVAC file changed before admission");
    }
    return { process, edits: submitted?.edits ?? {}, decisions: submitted?.decisions ?? {} };
  };
  return owner.admit(
    admission,
    validate,
    async (execution) => {
      const frozen = preparedTakeoffSchema.parse(execution.prepared);
      process = frozen.process;
      submitted = { edits: frozen.edits, decisions: frozen.decisions };
      if (admission.bases.captureId) {
        capture = await captures.saved(admission.bases.captureId);
        if (
          capture.provenance.kind !== "live" ||
          capture.provenance.target.session !== target.session ||
          capture.provenance.target.openId !== target.openId
        )
          throw refused("Original capture provenance does not match the admitted lifetime");
      }
      const native = <A = unknown>(key: string, input: unknown) =>
        execution.step("native", key, input, async (requestId) => {
          await current();
          const outcome = await Effect.runPromise(
            Effect.result(bridge.invoke(key, input, target.session, target.openId, requestId)),
          );
          if (outcome._tag === "Failure") throw outcome.failure;
          return outcome.success.value as A;
        });
      const prepare = async (stage: string) => {
        let remaining = Infinity;
        while (remaining > 0) {
          const result = await native<{ remaining: string[] }>("takeoffs.initialize-carrier", {
            stage,
          });
          if (!Array.isArray(result.remaining) || result.remaining.length >= remaining)
            throw Error("Carrier preparation made no progress");
          remaining = result.remaining.length;
        }
      };
      if (definition.dirties.includes("snapshot")) captures.invalidate(target);
      try {
        if (key === "takeoffs.initialize") {
          const input = takeoffActions[key].input.parse(admission.input);
          await prepare(input.stage);
          return { text: `wrote the shared parameters for ${input.stage}` };
        }
        if (key === "takeoffs.adopt") {
          const input = takeoffActions[key].input.parse(admission.input);
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
          const value = await native(key, { ...admission.input, runId: admission.id });
          return { value, target: { session: target.session, document: null } };
        }
        if (key === "rooms.partition") {
          await prepare("Rooms");
          const value = await native(key, { ...admission.input, runId: admission.id });
          return { value, target: { session: target.session, document: null } };
        }
        if (key === "rooms.draw" || key === "rooms.write") {
          await prepare("Rooms");
          const value = await native(key, admission.input);
          return { value, target: { session: target.session, document: null } };
        }
        const input = takeoffActions["takeoffs.sync"].input.parse(admission.input);
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
                  (flag) => submitted?.decisions[takeoffDecisionKey(room.guid, flag)] === undefined,
                ),
            ) ||
            zone.runs.some((run) => run.orphaned > 0 || run.failures > 0),
        );
        if (blocked.length) throw refused(`${blocked.length} selected zones are not ready to sync`);
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
                    : buildRhvacInsert(room, firstRoomNumber + index, systems.get(zone.tags[0]!)!),
                ),
                systems: [
                  ...before.systems.map((system) => ({ number: system.number, name: system.name })),
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
          { request, expectedVersion: admission.bases.fileVersion },
          () =>
            (
              deps.syncFile ??
              ((input, expectedVersion) =>
                Effect.runPromise(
                  rhvacSync(input, expectedVersion).pipe(Effect.provide(NodeServices.layer)),
                ))
            )(request, admission.bases.fileVersion!),
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
        if (admission.bases.work && submitted && work) {
          const consumed = new Map(
            [...linked, ...inserts.map(({ room }) => room)]
              .filter((room) => edits.has(room.guid))
              .map((room) => [room.guid, edits.get(room.guid)!]),
          );
          try {
            const current = await work.read(admission.bases.work.key, "takeoffs");
            if (!current) throw Error("Work unavailable after external success");
            const doc = takeoffsRouteState.schema.parse(current.doc);
            // Retire each consumed edit cell under the unchanged-cell rule: a value edited after
            // review survives. The host's retirement writes with the person's rights.
            const patches = [...consumed].flatMap(([roomId, edit]) =>
              Object.entries(edit.next).flatMap(([field, value]) => {
                const key = takeoffEditKey(roomId, field as keyof typeof edit.next);
                const cell = doc.edits[key];
                return cell
                  ? transitionPatches(["edits"], key, cell, { kind: "retire", consumed: { value } })
                  : [];
              }),
            );
            const publication = !patches.length
              ? { ok: true, unchanged: true }
              : await work.apply(
                  admission.bases.work.key,
                  "takeoffs",
                  "human",
                  patches,
                  current.revision,
                );
            await execution.publish(publication);
          } catch (error) {
            await execution.publish({ ok: false, error: String(error) });
          }
        }
        return {
          inserted: result.insertedRooms.length,
          updated: result.updated,
          text: `synced ${result.insertedRooms.length} inserted and ${result.updated} updated rooms into ${input.path}`,
          file: result,
        };
      } finally {
        if (definition.dirties.includes("snapshot")) captures.invalidate(target);
      }
    },
    resume,
  );
}

export const recoverTakeoffAction = (
  id: string,
  owner: ActionJournal,
  deps: TakeoffActionDependencies,
) =>
  owner.recover(id, (step, prepared) =>
    readNativeReceipt(step, preparedTakeoffSchema.parse(prepared).process, deps.sdk),
  );

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
