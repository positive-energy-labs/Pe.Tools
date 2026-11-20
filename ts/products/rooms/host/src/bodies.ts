/** The Rooms bodies the kernel calls outside a command: the HTTP route, the local operations, the host files and the snapshot call. */
import { Effect } from "effect";
import { addressSchema, documentRefSchema, sameAddress } from "@pe/agent-contracts";
import type { FileBody, HostBodies } from "@pe/agent-contracts/product";
import { BridgeError } from "@pe/host-internal/bridge";
import { io, refused } from "@pe/host-internal/command-executor";
import { HostNativeRead } from "@pe/host-internal/native-read";
import type { CallBody, LocalRun } from "@pe/host-internal/product";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { RhvacSyncRequest } from "@pe/rooms-contract/local-operations";
import { product } from "@pe/rooms-contract/product";
import { takeoffSnapshotInput } from "@pe/rooms-contract/takeoffs";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "./takeoff-ops.ts";
import * as rhvac from "./rhvac-ops.ts";
import type { Deps } from "./takeoffs.ts";

type Host = Partial<Deps>;
type Bodies = Required<HostBodies<typeof product, never, never, Host, LocalRun>>;
// ponytail: the capture store still arrives as a dependency; G3 replaces it with a declared capture.
const store = (deps: Host) => {
  if (!deps.captures) throw Error("This host holds no capture store");
  return deps.captures;
};
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

const observations = product.readings.observations.handle;
export const files: Record<string, FileBody<Host>> = {
  observation: (args, { deps }) => store(deps).query(observations.input.parse(args)),
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
    return store(deps).retain(
      projectTakeoffSnapshot(body, title, views),
      { kind: "live", target },
      async () => {
        const current = await document(target);
        if (!current.address || !sameAddress(current.address, address))
          throw Error("Snapshot target changed before retention");
      },
    );
  },
};

export const calls: Record<string, CallBody<Host>> = {
  "takeoffs.snapshot": Effect.fnUntraced(function* (
    { target, key, request, scope, selected },
    deps,
  ) {
    const document = yield* selected;
    if (!document?.address)
      return yield* new BridgeError("Snapshot requires an exact open saved document", 409);
    const at = addressSchema.parse(document.address);
    const native = yield* HostNativeRead;
    // Both natives are per-caller admitted and joined by NativeReads: a peer fetch shares them.
    const published = yield* store(deps).refresh(
      target,
      Effect.gen(function* () {
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
        return { result, snapshot };
      }),
      Effect.map(
        selected,
        (now) => !!now?.address && sameAddress(addressSchema.parse(now.address), at),
      ),
    );
    return {
      captureId: published.capture.id,
      value: published.result.value,
      nativeRequestId: published.result.nativeRequestId,
      target: { session: target.session, document: document.address, documentRef: target },
    };
  }),
};

export const http: Bodies["http"] = {
  "takeoffs.observations"({ query, session, openId }, deps) {
    const capture = query.get("capture") || undefined;
    const saved = query.has("saved");
    return store(deps).query({
      capture,
      saved,
      target: capture || saved ? undefined : documentRefSchema.parse({ session, openId }),
      text: query.has("text"),
      document: query.get("document") ?? undefined,
    });
  },
};

export const local: Bodies["local"] = {
  "takeoffs.saved": ({ captureId, ...input }, deps) =>
    Effect.tryPromise({
      try: () => store(deps).query({ ...input, capture: captureId, saved: true }),
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
