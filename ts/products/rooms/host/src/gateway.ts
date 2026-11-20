import { Effect } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/http";
import {
  addressSchema,
  documentRefSchema,
  readingRequestSchema,
  sameAddress,
  type DocumentRef,
} from "@pe/agent-contracts";
import { BridgeError } from "@pe/host-internal/bridge";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { io } from "@pe/host-internal/command-executor";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  type HostSessionScope,
  type BridgeSessionsListData,
  type TsOnlyRequest,
} from "@pe/host-contracts/operation-types";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { product } from "@pe/rooms-contract/product";
import { takeoffSnapshotInput } from "@pe/rooms-contract/takeoffs";
import { TakeoffCaptures } from "./takeoff-captures.ts";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "./takeoff-ops.ts";
import * as rhvac from "./rhvac-ops.ts";

type Roots = Parameters<typeof rhvac.rhvacOpen>[0];
type LocalKey = keyof typeof import("@pe/rooms-contract/local-operations").localOperationSchemas;
type Decode<E> = <K extends LocalKey>(
  key: K,
  request: unknown,
) => Effect.Effect<TsOnlyRequest<K>, E>;

const observation = product.http["takeoffs.observations"];

const snapshot = Effect.fnUntraced(function* <E, R>(
  captures: TakeoffCaptures,
  target: DocumentRef,
  key: string,
  request: unknown,
  readScope: HostSessionScope,
  selected: Effect.Effect<{ address?: string | null; title: string } | undefined, E, R>,
) {
  const document = yield* selected;
  if (!document?.address)
    return yield* new BridgeError("Snapshot requires an exact open saved document", 409);
  const at = addressSchema.parse(document.address);
  const native = yield* HostNativeRead;
  // Both natives are per-caller admitted and joined by NativeReads: a peer fetch shares them.
  const published = yield* captures.refresh(
    target,
    Effect.gen(function* () {
      const [result, index] = yield* Effect.all(
        [
          native.read({ key, input: request ?? {}, scope: readScope }),
          native.read({
            key: "revit.catalog.project-index",
            input: takeoffProjectIndexRequest,
            scope: readScope,
          }),
        ],
        { concurrency: "unbounded" },
      );
      const snapshot = projectTakeoffSnapshot(
        nativeResponseSchema("takeoffs.snapshot").parse(result.value),
        document.title,
        projectTakeoffViews(nativeResponseSchema("revit.catalog.project-index").parse(index.value)),
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
    target: {
      session: target.session,
      document: document.address,
      documentRef: target,
    },
  };
});

async function retainInput(
  captures: TakeoffCaptures,
  args: unknown,
  document: (
    target: DocumentRef,
  ) => Promise<{ address: import("@pe/agent-contracts").Address | null }>,
  sessions: () => Promise<BridgeSessionsListData>,
) {
  const { target, snapshot: body, views } = takeoffSnapshotInput.parse(args);
  const { address } = await document(target);
  if (!address || !sameAddress(address, addressSchema.parse(body.reading.at)))
    throw Error("Snapshot returned a different document");
  const known = await sessions();
  const title = known.sessions
    .find((session) => session.sessionId === target.session)
    ?.openDocuments?.find((doc) => doc.openId === target.openId)?.title;
  if (!title) throw Error("Snapshot document is no longer open");
  return captures.retain(
    projectTakeoffSnapshot(body, title, views),
    { kind: "live", target },
    async () => {
      const current = await document(target);
      if (!current.address || !sameAddress(current.address, address))
        throw Error("Snapshot target changed before retention");
    },
  );
}

const saved = Effect.fnUntraced(function* <E>(
  request: unknown,
  captures: TakeoffCaptures,
  decode: Decode<E>,
) {
  const { captureId, ...input } = yield* decode("takeoffs.saved", request ?? {});
  return yield* Effect.tryPromise({
    try: () => captures.query({ ...input, capture: captureId, saved: true }),
    catch: (error) => new BridgeError(String(error), 400),
  });
});

export const gateway = {
  Captures: TakeoffCaptures,
  ribbonTelemetry: ["CmdTakeoffsWeb"],
  captureHeader: "x-pe-takeoff-capture-id",
  observationInput: product.readings.observations.handle.input,
  observationResources: {
    "takeoff-saved": (input: { id?: string; text?: boolean }) =>
      [
        input.id
          ? `${observation.path}?capture=${encodeURIComponent(input.id)}${input.text ? "&text=1" : ""}`
          : `${observation.path}?saved`,
      ] as const,
  },
  savedResource(input: unknown) {
    const parsed = readingRequestSchema.safeParse(input);
    return parsed.success && parsed.data.kind === "takeoff-saved" ? parsed.data : undefined;
  },
  fileVersion: rhvac.fileVersion,
  retainInput,
  snapshot,
  saved,
  observationRoute(captures: () => TakeoffCaptures) {
    return HttpRouter.add(observation.method, observation.path, (req) =>
      Effect.tryPromise({
        try: async () => {
          const query = new URL(req.url, "http://host").searchParams;
          const capture = query.get("capture") || undefined;
          const saved = query.has("saved");
          const target =
            capture || saved
              ? undefined
              : documentRefSchema.parse({
                  session: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
                  openId: req.headers[HOST_RPC_DOCUMENT_HEADER],
                });
          const output = await captures().query({
            capture,
            saved,
            target,
            text: query.has("text"),
            document: query.get("document") ?? undefined,
          });
          return Response.jsonUnsafe(
            output satisfies import("zod").z.output<typeof observation.output>,
          );
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Response.jsonUnsafe({ error: String(error) }, { status: 400 })),
        ),
      ),
    );
  },
  calls<E>(roots: Roots, decodeRequest: Decode<E>) {
    const on =
      <K extends LocalKey, A, E2, R>(
        key: K,
        call: (input: TsOnlyRequest<K>) => Effect.Effect<A, E2, R>,
      ) =>
      ({ request }: { request: unknown }) =>
        Effect.flatMap(decodeRequest(key, request), call);
    return {
      "rhvac.open": on("rhvac.open", (input) => rhvac.rhvacOpen(roots, input)),
      "rhvac.assemblies": on("rhvac.assemblies", (input) => rhvac.rhvacAssemblies(roots, input)),
      "rhvac.sync": on("rhvac.sync", (input) => rhvac.rhvacSync(roots, input)),
      "rhvac.launch": on("rhvac.launch", rhvac.rhvacLaunch),
      "rhvac.takeoff": on("rhvac.takeoff", rhvac.rhvacTakeoff),
      "rhvac.list": on("rhvac.list", rhvac.rhvacList),
      "takeoffs.saved": ({ request, captures }: { request: unknown; captures: TakeoffCaptures }) =>
        saved(request, captures, decodeRequest),
    };
  },
  commandFiles(roots: Roots, { openFile, syncFile }: rhvac.RhvacOverrides) {
    return {
      open: (path: string) =>
        openFile ? io(() => openFile(path)) : rhvac.rhvacOpen(roots, { path }),
      sync: (request: TsOnlyRequest<"rhvac.sync">, expectedVersion: string) =>
        syncFile
          ? io(() => syncFile(request, expectedVersion))
          : rhvac.rhvacSync(roots, request, expectedVersion),
      applyStaged: rhvac.applyStaged,
      buildInsert: rhvac.buildRhvacInsert,
    };
  },
};
