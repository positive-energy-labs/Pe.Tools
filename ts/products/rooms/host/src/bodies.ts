/** The Rooms bodies the kernel calls outside a command: the HTTP route, the local operations, the host files and the snapshot call. */
import { Effect } from "effect";
import { addressSchema, documentRefSchema, sameAddress } from "@pe/agent-contracts";
import type { z } from "zod";
import type { FileBody, HostBodies } from "@pe/agent-contracts/product";
import { BridgeError } from "@pe/host-internal/bridge";
import { io, refused } from "@pe/host-internal/command-executor";
import { HostNativeRead } from "@pe/host-internal/native-read";
import type { EmitCall, LocalRun } from "@pe/host-internal/product";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { RhvacSyncRequest } from "@pe/rooms-contract/local-operations";
import { product } from "@pe/rooms-contract/product";
import {
  takeoffSnapshotInput,
  takeoffSnapshotSchema,
  type TakeoffSnapshot,
} from "@pe/rooms-contract/takeoffs";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "./takeoff-ops.ts";
import * as rhvac from "./rhvac-ops.ts";
import { takeoffs, type Deps } from "./takeoffs.ts";

type Host = Partial<Deps>;
type Bodies = Required<HostBodies<typeof product, never, never, Host, LocalRun, EmitCall>>;
const store = (deps: Host) => {
  const kept = takeoffs(deps);
  if (!kept) throw Error("This host holds no capture store");
  return kept;
};
const observations = product.readings.observations.handle;
/** The `observations` reading: one saved capture, the saved list, or the open document's status. */
async function query(
  deps: Host,
  { target, capture, text, saved, document }: z.output<typeof observations.input>,
) {
  const kept = store(deps);
  if (capture) return text ? kept.savedText(capture) : kept.saved(capture);
  if (!saved) {
    if (!target) throw Error("Observation status needs an exact open document");
    return kept.status(target);
  }
  const at = document ? addressSchema.parse(document) : undefined;
  return (await kept.list())
    .filter((row) => !at || sameAddress(row.snapshot.reading.at, at))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .map(({ snapshot, ...row }) => ({
      ...row,
      document: snapshot.reading.at,
      title: snapshot.world.docName,
    }));
}
/** What the kernel keeps of one snapshot. The store mints its id. */
const live = (target: z.output<typeof documentRefSchema>, snapshot: TakeoffSnapshot) => ({
  provenance: { kind: "live" as const, target },
  capturedAt: snapshot.reading.observedAt,
  snapshot: takeoffSnapshotSchema.parse(snapshot),
});
const roots = (deps: Host) => {
  if (!deps.roots) throw refused("This host named no roots for the RHVAC file lane");
  return deps.roots;
};

/** The `.r10` writer of the sync command. A test injects `openFile` and `syncFile` here. */
export const commandFiles = ({ openFile, syncFile, ...deps }: Host) => ({
  open: (path: string) =>
    openFile ? io(() => openFile(path)) : rhvac.rhvacOpen(roots(deps), { path }),
  sync: (request: RhvacSyncRequest, expectedVersion: string) =>
    syncFile
      ? io(() => syncFile(request, expectedVersion))
      : rhvac.rhvacSync(roots(deps), request, expectedVersion),
  applyStaged: rhvac.applyStaged,
  buildInsert: rhvac.buildRhvacInsert,
});

export const files: Record<string, FileBody<Host>> = {
  observation: (args, { deps }) => query(deps, observations.input.parse(args)),
  async "takeoff-capture"(args, { deps, document, sessions }) {
    const { target, snapshot: body, views } = takeoffSnapshotInput.parse(args);
    const { address } = await document(target);
    if (!address || !sameAddress(address, addressSchema.parse(body.reading.at)))
      throw Error("Snapshot returned a different document");
    const known = await sessions();
    const title = known.sessions
      .find((session) => session.sessionId === target.session)
      ?.openDocuments?.find((doc) => doc.openId === target.openId)?.title;
    if (!title) throw Error("Snapshot document is no longer open");
    // ponytail: a reading's host file keeps through the kind's handle; only the `snapshot` call is
    // wrapped by the kernel. Give `files` an `emits` of their own when a second reading keeps.
    return store(deps).keep(
      live(target, projectTakeoffSnapshot(body, title, views)),
      async () => {
        const current = await document(target);
        if (!current.address || !sameAddress(current.address, address))
          throw Error("Snapshot target changed before retention");
      },
    );
  },
};

// Unannotated, so `implement()` checks the table against what the declaration emits.
export const emits = {
  observations: Effect.fnUntraced(function* ({
    target,
    key,
    request,
    scope,
    selected,
  }: EmitCall["call"]) {
    const document = yield* selected;
    if (!document?.address)
      return yield* new BridgeError("Snapshot requires an exact open saved document", 409);
    const at = addressSchema.parse(document.address);
    const native = yield* HostNativeRead;
    // Both natives are per-caller admitted and joined by NativeReads: a peer fetch shares them.
    const [result, index] = yield* Effect.all(
          [
            native.read({ key, input: request ?? {}, scope }),
            native.read({
              key: "revit.catalog.project-index",
              input: takeoffProjectIndexRequest,
              scope,
            }),
          ],
          { concurrency: "unbounded" },
        );
        const snapshot = projectTakeoffSnapshot(
          nativeResponseSchema("takeoffs.snapshot").parse(result.value),
          document.title,
          projectTakeoffViews(
            nativeResponseSchema("revit.catalog.project-index").parse(index.value),
          ),
        );
    if (!sameAddress(snapshot.reading.at, at))
      return yield* new BridgeError("Snapshot returned a different document", 409);
    return {
      capture: live(target, snapshot),
      value: result.value,
      nativeRequestId: result.nativeRequestId,
      target: { session: target.session, document: document.address, documentRef: target },
    };
  }),
};

export const http: Bodies["http"] = {
  "takeoffs.observations"({ query: asked, session, openId }, deps) {
    const capture = asked.get("capture") || undefined;
    const saved = asked.has("saved");
    return query(deps, {
      capture,
      saved,
      target: capture || saved ? undefined : documentRefSchema.parse({ session, openId }),
      text: asked.has("text"),
      document: asked.get("document") ?? undefined,
    });
  },
};

export const local: Bodies["local"] = {
  "takeoffs.saved": ({ captureId, ...input }, deps) =>
    Effect.tryPromise({
      try: () => query(deps, { ...input, capture: captureId, saved: true }),
      catch: (error) => new BridgeError(String(error), 400),
    }),
  "rhvac.open": (input, deps) => Effect.suspend(() => rhvac.rhvacOpen(roots(deps), input)),
  "rhvac.assemblies": (input, deps) =>
    Effect.suspend(() => rhvac.rhvacAssemblies(roots(deps), input)),
  "rhvac.sync": (input, deps) => Effect.suspend(() => rhvac.rhvacSync(roots(deps), input)),
  "rhvac.launch": (input) => rhvac.rhvacLaunch(input),
  "rhvac.takeoff": (input) => rhvac.rhvacTakeoff(input),
  "rhvac.list": (input) => rhvac.rhvacList(input),
};
