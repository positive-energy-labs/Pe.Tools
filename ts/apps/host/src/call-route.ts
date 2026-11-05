import { httpProblems, isDoorFailure } from "./http-problems.ts";
import { nativeReadResolveEndpoint } from "../../../packages/agent-contracts/src/native-read-endpoint.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { InvalidRead } from "./native-reads.ts";
import { ReadFreshness, RequestIdentity } from "./request-services.ts";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { canonicalRouteInput, ductsSnapshotReadingSchema, nativePrincipals } from "@pe/agent-contracts";
import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import { peRoutes, linkedCatalog } from "@pe/agent-contracts/pe-api";
import { canonicalDuctsSession, ductsReadings } from "./ducts-readings.ts";
import {
  DUCTS_BODY_VERSION_HEADER,
  DUCTS_REFRESH_HEADER,
  type DuctsReadingRequest,
} from "@pe/agent-contracts";
import { sdkSession, SdkSession } from "./sdk-session.ts";
import { readSchedule } from "./schedule-actions.ts";
import { actionControls, commandTool, receiptsForWork } from "@pe/agent-contracts";
import { pointerThread, type ThreadPointers } from "./thread-pointers.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { operationDefinition, gatewayTarget, requireEligibleCaller } from "./gateway-actions.ts";
import {
  admitCrossing,
  admitScript,
  consentedRead,
  currentCaller,
  readsOnly,
  Refused,
  refusalHeaders,
  admitAnonymousCall,
} from "./control.ts";
import type { Caller } from "@pe/agent-contracts";
import { readFamily, type FamilyActionDependencies } from "./family-actions.ts";
import { actionAdmissionSchema, workKeySchema } from "@pe/agent-contracts";
import { z } from "zod";
import { fileVersion } from "./takeoff-actions.ts";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  addressSchema,
  sameAddress,
  documentRefSchema,
  actionStatusSchema,
} from "@pe/agent-contracts";
import { CaptureStore as TakeoffCaptureStore, type TakeoffCaptures } from "./takeoff-captures.ts";
import type { FamiliesReader } from "./families-reader.ts";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "../../../packages/mcps/src/shared/takeoff-ops.ts";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
import { CommandRejected, StepFailure } from "./command-executor.ts";
import { ActionJournal } from "./action-journal.ts";
import { bindCommandRuntime } from "./command-registry.ts";
import {
  captureOrigin,
  PictureCaptureStore,
  PictureStoreFull,
  registerViewImage,
} from "./captures-route.ts";
import { HostDocumentMarks } from "./document-marks.ts";
import { HostFiles } from "./host-files.ts";
import { randomUUID } from "node:crypto";
import { recordHostFact } from "./receipt-export.ts";
import { HttpRouter, HttpServerResponse as Response } from "effect/http";
import { RevitBridge, BridgeError, NoRevitSession } from "./bridge.ts";
import { apsAuthLogin, apsAuthLogout, apsAuthStatus, apsAuthToken } from "./aps-auth.ts";
import {
  getBridgeSessionSummary,
  getHostStatus,
  listBridgeSessions,
  openShellPath,
  tailLogs,
} from "./local-ops.ts";
import {
  composeMember,
  listPods,
  resolvePodIdentity,
  listRuns,
  readMember,
  saveMember,
  writeMember,
  type PodContext,
} from "./settings.ts";
import { LocalOpError, localOpHttpStatus } from "./local-error.ts";
import { capturePackage } from "./packages.ts";
import { exportPod, importPod, promotePage, TransferRefused } from "./pod-transfer.ts";
import {
  rhvacAssemblies,
  rhvacLaunch,
  rhvacList,
  rhvacOpen,
  rhvacSync,
  rhvacTakeoff,
} from "./rhvac-ops.ts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";
import type { HostErrorKind } from "@pe/host-contracts/contracts";

const readingSubjects: Record<
  "roster" | "walk" | "tables",
  (request: unknown, session: string, openId: string | null | undefined) => DuctsReadingRequest
> = {
  roster: (request, session, openId) => ({
    ...(request as object),
    kind: "ducts-snapshot",
    selector: { kind: "roster" },
    target: documentRefSchema.parse({ session, openId }),
  }),
  walk: (request, session, openId) => ({
    ...(request as object),
    kind: "ducts-snapshot",
    selector: ductsSnapshotReadingSchema.shape.selector.parse(
      (request as { selector?: unknown }).selector,
    ),
    target: documentRefSchema.parse({ session, openId }),
  }),
  tables: (request, session) => ({
    ...(request as { ids: string[] }),
    kind: "ducts-tables",
    session,
  }),
};

/** A door refusal: 403, named, and never dispatched. */
const refusedResponse = (error: Refused) =>
  Response.jsonUnsafe(
    { error: error.message, message: error.message, refusal: error.refusal, notDispatched: true },
    { status: 403, headers: refusalHeaders(error.refusal.code) },
  );

/** A refusal's own words. `BridgeError` is a plain class, so `String()` would say [object Object]. */
const said = (error: unknown): string =>
  error !== null && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);

/**
 * The entire browser/CLI-facing wire: POST /call { key, request? } → JSON.
 * TS-only ops dispatch locally. Native Reads require generated metadata, Schema admission,
 * and an exact SDK target before sharing. Unadmitted Pod queries refuse at this door.
 * Native failures use the typed problem mapper; remaining local handlers migrate with I.
 */

export type CallRouteDispatch = (
  ...args: Parameters<typeof dispatchTsOnlyOperation>
) => Effect.Effect<
  unknown,
  Effect.Error<ReturnType<typeof dispatchTsOnlyOperation>>,
  Effect.Services<ReturnType<typeof dispatchTsOnlyOperation>>
>;

export function makeCallRoute(
  operations: ActionJournal,
  captures?: TakeoffCaptures,
  actionDeps: FamilyActionDependencies & {
    launchShell?: (path: string) => Promise<void>;
  } = {},
  composition?: {
    readonly forwardBase?: string | null;
    readonly dispatch?: CallRouteDispatch;
    readonly origin?: () => string;
    readonly captureHostOp?: typeof recordHostOp;
    readonly local?: (key: string, input: unknown) => Promise<unknown>;
    /** The Families reader the host's layer built; absent where no Revit composition exists. */
    readonly families?: FamiliesReader["Service"];
    /** Thread meta's pointer surface; pointer ops refuse without it. */
    readonly pointers?: ThreadPointers;
  },
) {
  const CALL_FORWARD_BASE = process.env.PE_TOOLS_CALL_FORWARD?.trim().replace(/\/$/, "");
  if (CALL_FORWARD_BASE || composition?.forwardBase)
    throw Error(
      "Host forwarding is disabled: execution requires this runtime's own host and Revit.",
    );
  const families = () => {
    if (!composition?.families) throw Error("Families reads need the FamiliesReader service.");
    return composition.families;
  };
  const recordOperation = composition?.captureHostOp ?? recordHostOp;
  const dispatch: CallRouteDispatch = (...args) =>
    (composition?.dispatch ?? dispatchTsOnlyOperation)(...args);
  // The injected store, else the `CaptureStore` of the layer that builds these routes (set below,
  // before any handler can run).
  const observations = (): TakeoffCaptures => {
    if (!captures) throw Error("Takeoff captures are read before the call route layer is built.");
    return captures;
  };
  const owner = () => operations;
  const admit = async (raw: unknown, _bridge: RevitBridge["Service"], caller: Caller) => {
    const input = actionAdmissionSchema.parse(raw);
    const crossing = {
      caller,
      basis: admitCrossing(caller, input.target, "/actions", readsOnly(input.key, input.input)),
    };
    return owner().invoke(input, crossing);
  };
  // ADR 0029 read admission resolves implicit targets before sharing. The command
  // gateway still requires an exact id; no unresolved selector reaches dispatch.
  const admittedOpenId = (session: SdkSession | undefined, explicit: string | null | undefined) => {
    if (explicit !== undefined) return explicit;
    const active = session?.state?.openDocuments.filter((document) => document.isActive) ?? [];
    return active.length === 1 ? active[0]!.openId : undefined;
  };
  const resolveRead = HttpRouter.add(
    nativeReadResolveEndpoint.method,
    nativeReadResolveEndpoint.path,
    (req) =>
      Effect.gen(function* () {
        const identity = yield* RequestIdentity;
        const input = yield* req.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(nativeReadResolveEndpoint.body)),
          Effect.mapError(
            () =>
              new InvalidRead({
                message: "Invalid native read resolution request",
                status: 400,
                problem: "read.input",
              }),
          ),
        );
        const descriptor = yield* (yield* HostNativeRead).resolve({
          key: input.operationKey,
          input: input.input,
          scope: identity.scope,
        });
        return Response.jsonUnsafe(descriptor);
      }).pipe(
        Effect.catch((error) => {
          if (isDoorFailure(error)) return Effect.fail(error);
          const problem = toProblem(error);
          return Effect.succeed(
            Response.jsonUnsafe(
              {
                kind: "refused",
                failure: { code: "ReadResolutionRefused", message: problem.message },
              },
              { status: problem.status },
            ),
          );
        }),
      ),
  );
  const callDoor = peRoutes["operation.call"];
  const post = HttpRouter.add(callDoor.method, callDoor.path, (req) => {
    let captureId: string | undefined;
    let admissionRequestId: string = randomUUID();
    // Set once dispatch begins so the catch below can attribute failures to the op.
    let op:
      | {
          key: string;
          tsOnly: boolean;
          startedAt: number;
          origin: string;
          originClass: "human" | "pea" | "page" | "external" | "system";
          requestId: string;
        }
      | undefined;
    return Effect.gen(function* () {
      const identity = yield* RequestIdentity;
      const caller = identity.caller;
      const requestId = identity.requestId;
      admissionRequestId = requestId;
      // Lenient by ruling (queue-provenance §1): origin is attribution, not authorization —
      // a missing header is counted as "unknown", never rejected. No registry, no validation.
      const origin = req.headers[HOST_RPC_ORIGIN_HEADER]?.trim() || "unknown";
      const originClass =
        caller.kind === "human"
          ? "human"
          : caller.kind === "pea"
            ? "pea"
            : caller.kind === "page"
              ? "page"
              : caller.kind === "external-mcp"
                ? "external"
                : "system";
      const body = yield* req.json.pipe(Effect.mapError(() => invalidBody("unreadable JSON body")));
      if (!isRecord(body) || typeof body.key !== "string")
        return yield* Effect.fail(invalidBody("body must be { key: string, request?: object }"));
      // The /call envelope is exactly { key, request? }. Reject any other top-level key so
      // silently-ignored fields can't mis-target: a `bridgeSessionId` in the body once routed a
      // call to the user's live Revit — session targeting travels ONLY in the header.
      const unknownKey = Object.keys(body).find((k) => k !== "key" && k !== "request");
      if (unknownKey) return yield* Effect.fail(invalidBody(unknownBodyKeyMessage(unknownKey)));
      const key = body.key;
      if (key.startsWith("pod.") && !isAnyOperationKey(key))
        return yield* Effect.fail(
          new Refused({
            code: "permission.undeclared",
            door: "/call",
            reason: `Pod query has no admitted route: ${key}`,
          }),
        );
      const entry = linkedCatalog().entries.get(key)?.call ?? {};
      const humanDoor = entry.humanOnly;
      if (humanDoor && caller.kind !== "human")
        return Response.jsonUnsafe(
          { error: "Only a person can launch RHVAC", notDispatched: true },
          { status: 403 },
        );
      yield* Effect.try({ try: () => admitAnonymousCall(caller, key), catch: (error) => error });
      const request = "request" in body ? body.request : undefined;
      let scope: HostSessionScope = identity.scope;
      if (entry.canonicalSession && scope.bridgeSessionId) {
        const bridgeForScope = yield* RevitBridge;
        const canonicalSession = yield* Effect.tryPromise({
          try: () => canonicalDuctsSession(bridgeForScope, scope.bridgeSessionId!),
          catch: (error) => error,
        });
        scope = { ...scope, bridgeSessionId: canonicalSession };
      }
      let bridgeSessionId = scope.bridgeSessionId;
      let openDocumentId: string | null | undefined = scope.openDocumentId;

      if (entry.saved) {
        op = { key, tsOnly: true, startedAt: Date.now(), origin, originClass, requestId };
        const value = yield* savedTakeoffs(request, observations());
        recordOperation(op, { ok: true });
        return Response.jsonUnsafe(value);
      }

      if (entry.hostOnly) openDocumentId = null;
      const bridge = yield* RevitBridge;
      const resolvedSession =
        !isTsOnlyOperationKey(key) && !entry.cancel
          ? yield* (yield* SdkSession).resolve(scope)
          : undefined;
      bridgeSessionId = resolvedSession?.sessionId ?? bridgeSessionId;
      op = {
        key,
        tsOnly: isTsOnlyOperationKey(key),
        startedAt: Date.now(),
        origin,
        originClass,
        requestId,
      };
      let intent: string | undefined;
      if (entry.admission !== "intrinsic") {
        const definition = isTsOnlyOperationKey(key)
          ? yield* Effect.tryPromise({
              try: () => operationDefinition(key, bridge, resolvedSession),
              catch: (error) => error,
            })
          : yield* Effect.try({
              try: () => {
                const definition = hostOpCatalog.find((entry) => entry.key === key);
                if (!definition)
                  throw new InvalidRead({
                    message: "No generated native operation contract",
                    status: 404,
                    problem: "read.contract",
                  });
                return { ...definition, principal: nativePrincipals(definition.actor) };
              },
              catch: (error) => error,
            });
        const ref =
          resolvedSession && typeof openDocumentId === "string"
            ? { session: resolvedSession.sessionId, openId: openDocumentId }
            : undefined;
        intent = consentedRead(caller, key, request, ref) ? "Read" : definition.intent;
        if (intent === "Mutate" && !humanDoor) {
          return yield* Effect.fail(
            new BridgeError(
              "Submit the original exact admission to /actions; raw mutation dispatch is retired",
              409,
              { notDispatched: true },
            ),
          );
        }
        if (intent !== "Read" && !humanDoor)
          return yield* Effect.fail(
            new BridgeError("Unknown operation intent", 409, { notDispatched: true }),
          );
        yield* Effect.try({
          try: () => requireEligibleCaller(definition, caller, "/call"),
          catch: (error) => error,
        });
        if (!isTsOnlyOperationKey(key)) {
          const target = yield* Effect.try({
            try: () =>
              gatewayTarget(
                key,
                definition.needs,
                resolvedSession,
                admittedOpenId(resolvedSession, openDocumentId) ?? undefined,
              ),
            catch: (error) => error,
          });
          if (target.kind !== "host")
            bridgeSessionId = target.kind === "document" ? target.ref.session : target.session;
          openDocumentId = target.kind === "document" ? target.ref.openId : null;
          if (entry.script && resolvedSession) {
            const current = yield* (yield* SdkSession).resolve({
              bridgeSessionId: resolvedSession.sessionId,
              openDocumentId: openDocumentId ?? undefined,
            });
            yield* Effect.try({
              try: () =>
                admitScript(
                  caller,
                  current.state?.openDocuments.map((doc) => ({
                    session: current.sessionId,
                    openId: doc.openId,
                  })) ?? [],
                  "/call",
                  target.kind === "document" && readsOnly(key, request) ? target.ref : undefined,
                ),
              catch: (error) => error,
            });
          }
        }
      }
      if (entry.reading) {
        const nativeRead = yield* HostNativeRead;
        const input = {
          key,
          input: request ?? {},
          scope: {
            ...scope,
            bridgeSessionId: bridgeSessionId!,
            openDocumentId: openDocumentId ?? undefined,
          },
        };
        const admitted = yield* nativeRead.resolve(input);
        const subject = readingSubjects[entry.reading](request, bridgeSessionId!, openDocumentId);
        const target =
          subject.kind === "ducts-snapshot"
            ? subject.target
            : { session: subject.session, openId: undefined };
        const services = Context.make(RequestIdentity, identity);
        const owner = ductsReadings(bridge);
        let acquired = false;
        const shared = yield* Effect.tryPromise({
          try: () =>
            owner.read(subject, async () => {
              acquired = true;
              // effect-edge: island, phase 5; this cache-miss edge keeps the actual request identity.
              const answer = await Effect.runPromiseWith(services)(nativeRead.read(input));
              if (canonicalRouteInput(answer.actualTarget) !== canonicalRouteInput({
                processIncarnation: admitted.processIncarnation,
                openDocumentLifetime: admitted.openDocumentLifetime,
              })) throw new InvalidRead({
                message: "Ducts native response changed its admitted target",
                status: 409,
                problem: "read.target",
              });
              const actual = answer.actualTarget.openDocumentLifetime;
              const openId = "openId" in actual ? actual.openId : undefined;
              return {
                value: answer.value,
                nativeRequestId: answer.nativeRequestId,
                target: {
                  session: target.session,
                  document: resolvedSession?.state?.openDocuments.find((doc) => doc.openId === openId)?.address ?? null,
                  ...(openId ? { documentRef: { session: target.session, openId } } : {}),
                },
              };
            }, {
              version: req.headers[DUCTS_BODY_VERSION_HEADER],
              refresh: req.headers[DUCTS_REFRESH_HEADER],
            }),
          catch: (error) =>
            isDoorFailure(error) || error instanceof BridgeError
              ? error
              : new BridgeError(String(error), 409),
        });
        yield* Effect.try({
          try: () => owner.assertCurrent(subject, shared.version),
          catch: (error) => error,
        });
        recordOperation(op, { ok: true });
        return Response.text(shared.json, {
          headers: {
            "content-type": "application/json",
            ...resolvedTargetHeaders(shared.target),
            "x-pe-native-request-id": shared.nativeRequestId,
            [DUCTS_BODY_VERSION_HEADER]: shared.version,
            "x-pe-ducts-reused": String(!acquired),
          },
        });
      }
      const result = isTsOnlyOperationKey(key)
        ? {
            value: yield* dispatch(key, request, scope, bridge, observations(), {
              caller,
              pointers: composition?.pointers,
            }),
            target: null,
          }
        : entry.snapshot
          ? yield* Effect.tryPromise({
              try: async () => {
                const target = documentRefSchema.parse({
                  session: bridgeSessionId,
                  openId: openDocumentId,
                });
                const selected = async () => {
                  const resolve = SdkSession.resolve(bridge, { session: target.session });
                  // effect-edge: island, phase 5
                  const session = await Effect.runPromise(resolve);
                  return session.state?.openDocuments.find((doc) => doc.openId === target.openId);
                };
                const document = await selected();
                if (!document?.address)
                  throw new BridgeError("Snapshot requires an exact open saved document", 409);
                const at = addressSchema.parse(document.address);
                const published = await observations().refresh(
                  target,
                  async () => {
                    const [result, index] = await Promise.all([
                      // effect-edge: island, phase 5
                      Effect.runPromise(
                        bridge.invoke(key, request ?? {}, target.session, target.openId, requestId),
                      ),
                      // effect-edge: island, phase 5
                      Effect.runPromise(
                        bridge.invoke(
                          "revit.catalog.project-index",
                          takeoffProjectIndexRequest,
                          target.session,
                          target.openId,
                        ),
                      ),
                    ]);
                    const snapshot = projectTakeoffSnapshot(
                      result.value as OpResponseOf<"takeoffs.snapshot">,
                      document.title,
                      projectTakeoffViews(
                        index.value as OpResponseOf<"revit.catalog.project-index">,
                      ),
                    );
                    if (!sameAddress(snapshot.reading.at, at))
                      throw new BridgeError("Snapshot returned a different document", 409);
                    return { result, snapshot };
                  },
                  async () => {
                    const current = await selected();
                    return (
                      !!current?.address && sameAddress(addressSchema.parse(current.address), at)
                    );
                  },
                );
                captureId = published.capture.id;
                return published.result;
              },
              catch: (error) =>
                error instanceof BridgeError ? error : new BridgeError(String(error), 409),
            })
          : intent === "Read" && !entry.script
            ? yield* Effect.gen(function* () {
                if (!resolvedSession || !bridgeSessionId)
                  return yield* new InvalidRead({
                    message: "Native read needs an exact SDK incarnation",
                    status: 409,
                    problem: "read.target",
                  });
                const answer = yield* (yield* HostNativeRead).read({
                  key,
                  input: request ?? {},
                  scope: { ...scope, bridgeSessionId, openDocumentId: openDocumentId ?? undefined },
                });
                if (answer.actualTarget.processIncarnation.pid !== resolvedSession.processId ||
                    answer.actualTarget.processIncarnation.startedAt !== resolvedSession.processStartUtcUnixMs)
                  return yield* new InvalidRead({ message: "Native read incarnation changed during admission", status: 409, problem: "read.target" });
                const actualOpen =
                  "openId" in answer.actualTarget.openDocumentLifetime
                    ? answer.actualTarget.openDocumentLifetime.openId
                    : undefined;
                return {
                  value: answer.value,
                  nativeRequestId: answer.nativeRequestId,
                  target: {
                    session: bridgeSessionId,
                    document:
                      resolvedSession.state?.openDocuments.find((doc) => doc.openId === actualOpen)
                        ?.address ?? null,
                    ...(actualOpen
                      ? { documentRef: { session: bridgeSessionId, openId: actualOpen } }
                      : {}),
                  },
                };
              })
            : yield* bridge.invoke(key, request ?? {}, bridgeSessionId, openDocumentId, requestId);
      // A joined Read names the dispatch that actually ran, never this caller's unsent id.
      const nativeRequestId =
        "nativeRequestId" in result && typeof result.nativeRequestId === "string"
          ? result.nativeRequestId
          : requestId;
      const kept = entry.capture
        ? yield* registerViewImage(
            result.value,
            request,
            captureOrigin(origin, caller),
            bridge,
            { session: bridgeSessionId, openId: openDocumentId },
          )
        : null;
      recordOperation(op, { ok: true });
      // Every /call response names the target it actually ran against, so a tool card can show
      // what was touched rather than the selector that was typed. Headers, not a payload wrapper.
      // A TS-only op touched no Revit, so it stamps nothing rather than the latest session.
      const headers = result.target ? resolvedTargetHeaders(result.target) : {};
      if (!op.tsOnly && !entry.cancel) headers["x-pe-native-request-id"] = nativeRequestId;
      if (captureId) headers["x-pe-takeoff-capture-id"] = captureId;
      if (kept)
        Object.assign(headers, { "x-pe-capture-id": kept.id, "x-pe-capture-url": kept.url });
      return Response.jsonUnsafe(result.value ?? null, { headers });
    }).pipe(
      Effect.catch((error) => {
        if (isDoorFailure(error)) return Effect.fail(error);
        const problem = toProblem(error);
        if (op) recordOperation(op, { ok: false, problem });
        else if (problem.status >= 500)
          recordHostFact(
            {
              kind: "usage",
              event: "host_fault",
              counters: { routeCode: "call", faultCode: "host.failed", status: problem.status },
            },
            { requestId: admissionRequestId },
          );
        return Effect.succeed(
          error instanceof Refused
            ? refusedResponse(error)
            : Response.jsonUnsafe(problem, {
                status: problem.status,
                headers: { "content-type": "application/problem+json" },
              }),
        );
      }),
    );
  });
  const familiesReadings = HttpRouter.add("*", "/families/readings", (req) => {
    const caller = currentCaller();
    return RevitBridge.use((bridge) =>
      Effect.tryPromise({
        try: async () => {
          if (req.method === "GET") {
            const query = new URL(req.url, "http://host").searchParams;
            const id = query.get("id");
            const raw = query.get("work");
            const format = query.get("format");
            const record = query.get("record");
            if (record)
              return Response.uint8Array(await observations().familyRecord(record), {
                contentType: "application/json",
              });
            if (id && raw) throw Error("Choose one Families reading lookup");
            if (format) {
              if (!id) throw Error("A Families reading ID is required for an artifact reference");
              if (format === "parts")
                return Response.jsonUnsafe(await observations().familiesParts(id));
              if (format === "reference")
                return Response.jsonUnsafe(await observations().familiesReference(id));
              if (format === "artifact")
                return Response.uint8Array(await observations().familiesArtifact(id), {
                  contentType: "application/json",
                });
              if (format === "parameters-cache")
                return Response.uint8Array(
                  await observations().apsParameterCacheArtifact(id, query.get("sha256") ?? ""),
                  { contentType: "application/json" },
                );
              throw Error(`Unknown Families reading format '${format}'`);
            }
            if (id) return Response.jsonUnsafe(await observations().families(id));
            if (!raw) return Response.jsonUnsafe(await observations().familiesReadings());
            const work = workKeySchema
              .and(z.object({ route: z.literal("families") }))
              .parse(JSON.parse(raw));
            return Response.jsonUnsafe(await observations().displayedFamilies(work));
          }
          if (req.method === "DELETE") {
            const { readId } = z
              .strictObject({ readId: z.uuid() })
              // effect-edge: island, phase 5
              .parse(await Effect.runPromise(req.json));
            const target = documentRefSchema.parse({
              session: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
              openId: req.headers[HOST_RPC_DOCUMENT_HEADER],
            });
            // effect-edge: island, phase 5
            const session = await Effect.runPromise(
              sdkSession(
                bridge,
                { bridgeSessionId: target.session, openDocumentId: target.openId },
                actionDeps.sdk,
              ),
            );
            requireEligibleCaller(
              await operationDefinition("revit.matrix.loaded-families", bridge, session),
              caller,
              "/families/readings",
            );
            await families().cancel(readId, target);
            return Response.jsonUnsafe({ cancelled: true });
          }
          if (req.method !== "POST") throw Error("Unsupported Families reading method");
          const body = z
            .strictObject({
              work: workKeySchema.and(z.object({ route: z.literal("families") })),
              expectedRevision: z.number().int().nonnegative().optional(),
              readId: z.uuid(),
              filter: z.strictObject({
                categoryNames: z.array(z.string()).min(1),
                familyNames: z.array(z.string()),
                placementScope: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]),
              }),
            })
            // effect-edge: island, phase 5
            .parse(await Effect.runPromise(req.json));
          const target = documentRefSchema.parse({
            session: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
            openId: req.headers[HOST_RPC_DOCUMENT_HEADER],
          });
          // effect-edge: island, phase 5
          const resolvedSession = await Effect.runPromise(
            sdkSession(
              bridge,
              {
                bridgeSessionId: target.session,
                openDocumentId: target.openId,
              },
              actionDeps.sdk,
            ),
          );
          const definition = await operationDefinition(
            "revit.matrix.loaded-families",
            bridge,
            resolvedSession,
          );
          requireEligibleCaller(definition, caller, "/families/readings");
          if (definition.intent !== "Read") throw Error("Matrix operation must be a read");
          const resolved = gatewayTarget(
            "revit.matrix.loaded-families",
            definition.needs,
            resolvedSession,
            target.openId,
          );
          if (
            resolved.kind !== "document" ||
            resolved.ref.session !== target.session ||
            resolved.ref.openId !== target.openId
          )
            throw Error("Families read requires the exact project document");
          // effect-edge: island, phase 5
          const session = await Effect.runPromise(
            SdkSession.resolve(bridge, { session: target.session }),
          );
          const document = session.state?.openDocuments.find((row) => row.openId === target.openId);
          if (body.work.binding === "address") {
            if (
              !document?.address ||
              !sameAddress(addressSchema.parse(document.address), body.work.target)
            )
              throw Error("Families Work belongs to another document");
          } else if (
            body.work.binding !== "open" ||
            body.work.open.session !== target.session ||
            body.work.open.openId !== target.openId
          )
            throw Error("Families Work belongs to another document");
          const saved = await families().read({
            bridge,
            captures: observations(),
            readId: body.readId,
            work: body.work,
            document: target,
            documentTitle: document?.title ?? undefined,
            filter: body.filter,
          });
          if (body.expectedRevision !== undefined && saved.progress?.state === "complete") {
            if (!actionDeps.workspace)
              throw Error("Families observation requires the connected Work owner");
            const published = await actionDeps.workspace.publish(
              body.work,
              "families",
              [{ path: ["takenAt"], value: saved.capturedAt }],
              body.expectedRevision,
            );
            if (!published.ok)
              throw Error(`Families observation refused: ${JSON.stringify(published)}`);
            return Response.jsonUnsafe({
              ...saved,
              envelope: { version: 1, revision: published.revision, doc: published.doc },
            });
          }
          return Response.jsonUnsafe(saved);
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Response.jsonUnsafe({ error: said(error) }, { status: 409 })),
        ),
      ),
    );
  });
  const captured = HttpRouter.add("GET", "/takeoffs/observations", (req) =>
    Effect.tryPromise({
      try: async () => {
        const query = new URL(req.url, "http://host").searchParams;
        const id = query.get("capture");
        if (id && query.has("text")) return Response.jsonUnsafe(await observations().savedText(id));
        if (id) return Response.jsonUnsafe(await observations().saved(id));
        if (query.has("saved")) {
          const document = query.get("document");
          const rows = await observations().list(
            document ? addressSchema.parse(document) : undefined,
          );
          return Response.jsonUnsafe(
            rows.map(({ snapshot, ...capture }) => ({
              ...capture,
              document: snapshot.reading.at,
              title: snapshot.world.docName,
            })),
          );
        }
        return Response.jsonUnsafe(
          observations().status(
            documentRefSchema.parse({
              session: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
              openId: req.headers[HOST_RPC_DOCUMENT_HEADER],
            }),
          ),
        );
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Response.jsonUnsafe({ error: String(error) }, { status: 400 })),
      ),
    ),
  );
  const admitDoor = peRoutes["actions.admit"];
  const actions = HttpRouter.add(admitDoor.method, admitDoor.path, (req) =>
    Effect.gen(function* () {
      // The caller lives in AsyncLocalStorage; the Node body read resumes outside it. Read first.
      const caller = currentCaller();
      const body = yield* req.json;
      const bridge = yield* RevitBridge;
      const row = yield* Effect.tryPromise({
        try: () => admit(body, bridge, caller),
        catch: (error) => error,
      });
      return Response.jsonUnsafe(row, {
        status: row.state === "running" || row.state === "waiting" ? 202 : 200,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          error instanceof Refused
            ? refusedResponse(error)
            : Response.jsonUnsafe(
                {
                  error: String(error),
                  message:
                    typeof error === "object" && error && "message" in error
                      ? String(error.message)
                      : String(error),
                },
                { status: 409 },
              ),
        ),
      ),
    ),
  );
  const readDoor = peRoutes["actions.read"];
  const actionReads = HttpRouter.add(readDoor.method, readDoor.path, (req) => {
    const caller = currentCaller();
    return Effect.tryPromise({
      try: async () => {
        const query = new URL(req.url, "http://host").searchParams;
        if (query.has("file")) {
          if (caller.kind !== "human" && caller.kind !== "pea")
            throw new Refused({
              code: "context.missing",
              door: "/actions",
              reason: "File versions require a human or Pea caller",
            });
          const path = query.get("file")!;
          return Response.jsonUnsafe({
            path,
            fileVersion: await (actionDeps.fileVersion ?? fileVersion)(path),
          });
        }
        // Exported inputs by original action ID; the receipt, not this, says how the action settled.
        if (query.has("output")) {
          const visible = await owner().readFor(caller, undefined, query.get("output")!);
          if (!visible.length) throw Error("No retained command owns this output");
          return Response.jsonUnsafe(await owner().outputs(query.get("output")!));
        }
        const session = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
          openId = req.headers[HOST_RPC_DOCUMENT_HEADER];
        const target = session && openId ? documentRefSchema.parse({ session, openId }) : undefined;
        const id = query.get("id") ?? undefined;
        let rows = await owner().readFor(caller, target, id);
        const wait = Number(query.get("wait") ?? 0);
        if (id && rows.length && Number.isFinite(wait) && wait > 0) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              owner().wait(id),
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, Math.min(wait, 30_000));
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
          rows = await owner().readFor(caller, target, id);
        }
        if (query.has("work")) {
          rows = receiptsForWork(rows, workKeySchema.parse(JSON.parse(query.get("work")!)));
        }
        if (query.has("tool"))
          rows = rows.filter((row) => commandTool(row.key)?.name === query.get("tool"));
        return Response.jsonUnsafe(query.has("id") ? rows : actionStatusSchema.array().parse(rows));
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          error instanceof Refused
            ? refusedResponse(error)
            : Response.jsonUnsafe({ error: String(error) }, { status: 400 }),
        ),
      ),
    );
  });
  // action.read is GET /actions; every other control is POST /actions/<verb>, the path the client builds.
  const { "action.read": _readControl, ...writeControls } = actionControls;
  const controlVerbs = Object.keys(writeControls) as (keyof typeof writeControls)[];
  const controls = controlVerbs.map((id) => {
    const choice = id.slice("action.".length);
    return HttpRouter.add(peRoutes[id].method, peRoutes[id].path, (req) => {
      const caller = currentCaller();
      return RevitBridge.use((_bridge) =>
        Effect.tryPromise({
          try: async () => {
            // effect-edge: island, phase 5
            const body = await Effect.runPromise(req.json);
            if (!isRecord(body) || typeof body.id !== "string")
              throw Error("An original action ID is required");
            const controlled = (await owner().readFor(caller, undefined, body.id))[0];
            if (!controlled) throw Error(`Action '${body.id}' has no admitted receipt`);
            // The journal resolves control behavior from the same executor as invocation.
            if (choice === "cancel")
              return Response.jsonUnsafe(await owner().cancel(body.id), { status: 202 });
            if (choice === "recover") return Response.jsonUnsafe(await owner().recover(body.id));
            if (choice !== "resume") throw Error(`Action control '${choice}' has no handler`);
            const crossing = {
              caller,
              basis: admitCrossing(
                caller,
                controlled.target,
                "/actions/resume",
                readsOnly(controlled.key, controlled.input),
              ),
            };
            const row = await owner().resume(body.id, crossing);
            return Response.jsonUnsafe(row, {
              status: row.state === "running" || row.state === "waiting" ? 202 : 200,
            });
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              error instanceof Refused
                ? refusedResponse(error)
                : Response.jsonUnsafe({ error: said(error) }, { status: 409 }),
            ),
          ),
        ),
      );
    });
  });
  const familyReadings = HttpRouter.add("*", "/family/readings", (req) =>
    RevitBridge.use((bridge) =>
      Effect.tryPromise({
        try: async () => {
          if (req.method === "POST") {
            // effect-edge: island, phase 5
            const body = await Effect.runPromise(req.json);
            if (!isRecord(body) || typeof body.key !== "string")
              throw Error("A Family read key is required");
            return Response.jsonUnsafe(
              await readFamily(
                { ...body, key: body.key, scope: body.scope },
                observations(),
                bridge,
                actionDeps,
              ),
            );
          }
          const query = new URL(req.url, "http://host").searchParams;
          if (query.has("id"))
            return Response.jsonUnsafe(await observations().family(query.get("id")!));
          const scope = workKeySchema.parse(JSON.parse(query.get("scope") ?? "{}"));
          return Response.jsonUnsafe(await observations().familyReadings(scope));
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Response.jsonUnsafe({ error: said(error) }, { status: 409 })),
        ),
      ),
    ),
  );
  const scheduleReadings = HttpRouter.add("POST", "/schedules/readings", (req) =>
    RevitBridge.use((bridge) =>
      Effect.tryPromise({
        try: async () => {
          // effect-edge: island, phase 5
          const body = await Effect.runPromise(req.json);
          if (!isRecord(body) || typeof body.key !== "string")
            throw Error("Schedule read key required");
          return Response.jsonUnsafe(
            await readSchedule(
              { key: body.key, input: body.input, target: body.target },
              observations(),
              bridge,
              actionDeps,
            ),
          );
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Response.jsonUnsafe({ error: said(error) }, { status: 409 })),
        ),
      ),
    ),
  );
  return Layer.mergeAll(
    Layer.effectDiscard(
      RevitBridge.use((bridge) =>
        Effect.gen(function* () {
          // The host provides one store for the whole app; a composition with none owns its own,
          // closed with this layer's scope.
          captures ??=
            Option.getOrUndefined(yield* Effect.serviceOption(TakeoffCaptureStore)) ??
            Context.get(yield* Layer.build(TakeoffCaptureStore.layer()), TakeoffCaptureStore);
          actionDeps = { ...actionDeps, marks: yield* HostDocumentMarks, pictures: yield* PictureCaptureStore, files: yield* HostFiles };
          const freshness = yield* ReadFreshness;
          yield* Effect.acquireRelease(
            // Queue/native-read telemetry must not invalidate an in-flight read's identity.
            Effect.sync(() =>
              operations.subscribe({ kinds: ["action"] }, () => freshness.advance()),
            ),
            (release) => Effect.sync(release),
          );
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              bridge.subscribe((event) => {
                // Queue/progress notifications and unchanged state snapshots are not writes.
                if (
                  event.kind === "connected" ||
                  event.kind === "disconnected" ||
                  (event.kind === "state-sync" && event.docChanged) ||
                  (event.kind === "event" && event.eventName === "document-changed")
                )
                  freshness.advance();
              }),
            ),
            (release) => Effect.sync(release),
          );
          bindCommandRuntime(
            operations,
            bridge,
            observations(),
            { ...actionDeps, families: composition?.families, nativeRead: yield* HostNativeRead },
            composition?.local ??
              ((key, input) =>
                executeGatewayLocal(key, input, bridge, observations(), actionDeps.pictures!, actionDeps.launchShell)),
            composition?.origin,
          );
        }),
      ),
    ),
    post.pipe(Layer.provide(httpProblems)),
    resolveRead.pipe(Layer.provide(httpProblems)),
    familiesReadings,
    captured,
    actions,
    actionReads,
    familyReadings,
    scheduleReadings,
    ...controls,
  ).pipe(
    HttpRouter.provideRequest(Layer.effect(PictureCaptureStore, PictureCaptureStore)),
    HttpRouter.provideRequest(Layer.effectContext(Effect.gen(function* () {
      return Context.make(HostNativeRead, yield* HostNativeRead)
        .pipe(Context.add(SdkSession, yield* SdkSession));
    }))),
  );
}

const savedTakeoffs = Effect.fnUntraced(function* (request: unknown, captures: TakeoffCaptures) {
  const input = yield* decodeRequest("takeoffs.saved", request ?? {});
  return yield* Effect.tryPromise({
    try: async () =>
      input.captureId && input.text
        ? captures.savedText(input.captureId)
        : input.captureId
          ? captures.saved(input.captureId)
          : (
              await captures.list(input.document ? addressSchema.parse(input.document) : undefined)
            ).map(({ snapshot, ...capture }) => ({
              ...capture,
              document: snapshot.reading.at,
              title: snapshot.world.docName,
            })),
    catch: (error) => new BridgeError(String(error), 400),
  });
});

/** Reads are observations joined to the exact dispatch UUID; inputs and errors stay local. */
function recordHostOp(
  op: {
    key: string;
    tsOnly: boolean;
    startedAt: number;
    origin: string;
    originClass: "human" | "pea" | "page" | "external" | "system";
    requestId: string;
  },
  outcome: { ok: true } | { ok: false; problem: { kind: string; message: string; status: number } },
): void {
  const refused = !outcome.ok && outcome.problem.status >= 400 && outcome.problem.status < 500;
  const join = { requestId: op.requestId };
  recordHostFact(
    {
      kind: "usage",
      event: "host_op",
      counters: {
        op: op.key,
        originClass: op.originClass,
        tsOnly: op.tsOnly,
        outcome: outcome.ok ? "incomplete" : refused ? "refused" : "failed",
        ...(outcome.ok || refused ? {} : { faultCode: "host.failed" as const }),
        durationMs: Date.now() - op.startedAt,
      },
    },
    join,
  );
  if (!outcome.ok && !refused)
    recordHostFact(
      {
        kind: "usage",
        event: "host_fault",
        counters: { routeCode: "call", faultCode: "host.failed", status: outcome.problem.status },
      },
      join,
    );
}

const RESOLVED_SESSION_HEADER = "x-pe-resolved-session";
const RESOLVED_DOCUMENT_HEADER = "x-pe-resolved-document";

function resolvedTargetHeaders({
  session,
  document,
  documentRef,
}: {
  session: string;
  document: string | null;
  documentRef?: { session: string; openId: string };
}): Record<string, string> {
  const headers: Record<string, string> = {};
  headers[RESOLVED_SESSION_HEADER] = session;
  if (document) headers[RESOLVED_DOCUMENT_HEADER] = encodeURIComponent(document);
  if (documentRef?.session === session && documentRef.openId)
    headers["x-pe-resolved-open-id"] = encodeURIComponent(documentRef.openId);
  return headers;
}

class InvalidHostRequest {
  readonly _tag = "InvalidHostRequest";
  constructor(
    readonly key: string,
    readonly message: string,
  ) {}
}

function invalidBody(message: string) {
  return new InvalidHostRequest("host.call", message);
}

function unknownBodyKeyMessage(key: string): string {
  const base = `unknown top-level body key '${key}'; the /call envelope is exactly { key, request? }`;
  return key === "bridgeSessionId"
    ? `${base}. Session targeting is not a body field — pass it in the '${HOST_RPC_BRIDGE_SESSION_HEADER}' header.`
    : `${base}.`;
}

const dispatchTsOnlyOperation = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
  scope: HostSessionScope | undefined,
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  via: { caller: Caller; pointers?: ThreadPointers },
) {
  return yield* localEntries[key]({ request, scope, bridge, captures, ...via });
});

type LocalCall = {
  request: unknown;
  scope: HostSessionScope | undefined;
  bridge: RevitBridge["Service"];
  captures: TakeoffCaptures;
  caller: Caller;
  pointers?: ThreadPointers;
};
const pointerOwner = (pointers: ThreadPointers | undefined) => {
  if (!pointers) throw Error("Pointers need this host's thread store.");
  return pointers;
};
const localEntries = {
  "pointers.point": Effect.fnUntraced(function* ({ request, caller, pointers }: LocalCall) {
    const input = yield* decodeRequest("pointers.point", request);
    return pointerOwner(pointers).point(pointerThread(caller, undefined), input);
  }),
  "pointers.list": Effect.fnUntraced(function* ({ request, caller, pointers }: LocalCall) {
    const input = yield* decodeRequest("pointers.list", request);
    return pointerOwner(pointers).read(pointerThread(caller, input.thread));
  }),
  "pointers.dismiss": Effect.fnUntraced(function* ({ request, caller, pointers }: LocalCall) {
    const input = yield* decodeRequest("pointers.dismiss", request);
    return pointerOwner(pointers).dismiss(pointerThread(caller, input.thread), input.id);
  }),
  "takeoffs.saved": Effect.fnUntraced(function* ({ request, captures }: LocalCall) {
    return yield* savedTakeoffs(request, captures);
  }),
  "host.status": Effect.fnUntraced(function* ({ bridge }: LocalCall) {
    return yield* Effect.flatMap(
      Effect.map(bridge.list, (sessions) => ({ connected: sessions.some((s) => s.connected) })),
      (snapshot) => getHostStatus(snapshot),
    );
  }),
  "host.topology": Effect.fnUntraced(function* ({ bridge }: LocalCall) {
    // The operator's map: host identity + all sessions in one snapshot (ADR 0003).
    const host = yield* Effect.flatMap(
      Effect.map(bridge.list, (sessions) => ({ connected: sessions.some((s) => s.connected) })),
      (snapshot) => getHostStatus(snapshot),
    );
    const sessions = yield* listBridgeSessions(bridge.list);
    return {
      observedAtUtc: new Date().toISOString(),
      host,
      sessions: sessions.sessions,
    };
  }),
  "bridge.sessions.summary": Effect.fnUntraced(function* ({ scope, bridge }: LocalCall) {
    return yield* Effect.flatMap(sdkSession(bridge, scope), getBridgeSessionSummary);
  }),
  "bridge.sessions.list": Effect.fnUntraced(function* ({ bridge }: LocalCall) {
    return yield* listBridgeSessions(bridge.list);
  }),
  "logs.tail": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* tailLogs(yield* decodeRequest("logs.tail", request));
  }),
  "host.shell.open": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* openShellPath(yield* decodeRequest("host.shell.open", request));
  }),
  "pod.list": Effect.fnUntraced(function* ({ request }: LocalCall) {
    const input = yield* decodeRequest("pod.list", request);
    return input.projection === "identity"
      ? yield* resolvePodIdentity(input.folder)
      : yield* listPods();
  }),
  "pod.capture": Effect.fnUntraced(function* ({ request }: LocalCall) {
    const { pod } = yield* decodeRequest("pod.capture", request);
    return yield* Effect.tryPromise({
      try: () => capturePackage(pod),
      catch: (error) => packageError("pod.capture", error),
    }).pipe(
      Effect.map(
        ({ id, folder, directory, entrypoints, contributions, memberBundle, sourceBundle }) => ({
          id,
          folder,
          directory,
          entrypoints,
          contributions,
          memberBundle,
          sourceBundle,
        }),
      ),
    );
  }),
  "pod.export": Effect.fnUntraced(function* ({ request }: LocalCall) {
    const input = yield* decodeRequest("pod.export", request);
    const captures = yield* PictureCaptureStore;
    return yield* transfer("pod.export", () => exportPod(input, { captures }));
  }),
  "pod.import": Effect.fnUntraced(function* ({ request }: LocalCall) {
    const input = yield* decodeRequest("pod.import", request);
    const captures = yield* PictureCaptureStore;
    return yield* transfer("pod.import", () => importPod(input, { captures }));
  }),
  "pod.promote": Effect.fnUntraced(function* ({ request }: LocalCall) {
    const input = yield* decodeRequest("pod.promote", request);
    const captures = yield* PictureCaptureStore;
    return yield* transfer("pod.promote", () => promotePage(input, { captures }));
  }),
  "pod.runs": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* listRuns(yield* decodeRequest("pod.runs", request));
  }),
  "pod.member.read": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* readMember(yield* decodeRequest("pod.member.read", request));
  }),
  "pod.member.write": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* writeMember(yield* decodeRequest("pod.member.write", request));
  }),
  "pod.member.save": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* saveMember(yield* decodeRequest("pod.member.save", request));
  }),
  "pod.member.compose": Effect.fnUntraced(function* ({ request, scope, bridge }: LocalCall) {
    return yield* composeMember(
      yield* decodeRequest("pod.member.compose", request),
      yield* podContext(bridge, scope),
    );
  }),
  "rhvac.open": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacOpen(yield* decodeRequest("rhvac.open", request));
  }),
  "rhvac.assemblies": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacAssemblies(yield* decodeRequest("rhvac.assemblies", request));
  }),
  "rhvac.sync": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacSync(yield* decodeRequest("rhvac.sync", request));
  }),
  "rhvac.launch": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacLaunch(yield* decodeRequest("rhvac.launch", request));
  }),
  "rhvac.takeoff": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacTakeoff(yield* decodeRequest("rhvac.takeoff", request));
  }),
  "rhvac.list": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* rhvacList(yield* decodeRequest("rhvac.list", request));
  }),
  "aps.auth.status": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* apsAuthStatus(yield* decodeRequest("aps.auth.status", request));
  }),
  "aps.auth.login": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* apsAuthLogin(yield* decodeRequest("aps.auth.login", request));
  }),
  "aps.auth.logout": Effect.fnUntraced(function* (_call: LocalCall) {
    return yield* apsAuthLogout();
  }),
  "aps.auth.token": Effect.fnUntraced(function* ({ request }: LocalCall) {
    return yield* apsAuthToken(yield* decodeRequest("aps.auth.token", request));
  }),
};

/**
 * Archive transport is host-only. A refusal is a settled answer (the transfer is all-or-nothing, so
 * nothing landed): it fails the receipt with its own status instead of leaving it unknown.
 */
const transfer = <A>(key: "pod.export" | "pod.import" | "pod.promote", run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof TransferRefused
        ? new BridgeError(error.message, error.status, { dispatched: true })
        : new LocalOpError(key, error instanceof Error ? error.message : String(error)),
  });

/** A package refusal keeps its own words; identity misses are 404, twins 409, bad members 422. */
const packageError = (key: string, error: unknown) => {
  const note = error instanceof Error ? error.message : String(error);
  return new LocalOpError(
    key,
    note,
    note.startsWith("No installed pod") ? 404 : note.includes("claimed by folders") ? 409 : 422,
  );
};

/** A session-less host composes schema-only; it never pretends a bridge is there. */
const podContext = Effect.fnUntraced(function* (
  bridge: RevitBridge["Service"],
  scope: HostSessionScope | undefined,
) {
  if (!scope?.session && !scope?.bridgeSessionId) return {} satisfies PodContext;
  const session = yield* sdkSession(bridge, scope);
  if (!session.connected || !session.sessionId) return {} satisfies PodContext;
  return {
    invokeBridge: (key, payload) =>
      bridge.invoke(key, payload, session.sessionId).pipe(Effect.map((result) => result.value)),
  } satisfies PodContext;
});

type RequestSchemaOf<K extends TsOnlyOperationKey> = (typeof tsOnlyOperationSchemas)[K] extends {
  readonly request: infer S extends Schema.Codec<any>;
}
  ? S
  : never;

const decodeRequest = Effect.fnUntraced(function* <K extends TsOnlyOperationKey>(
  key: K,
  request: unknown,
) {
  const schemas = tsOnlyOperationSchemas[key] as { request?: Schema.Codec<unknown> };
  if (!schemas.request) return {} as never;
  return (yield* Schema.decodeUnknownEffect(schemas.request, { onExcessProperty: "error" })(
    request ?? {},
  ).pipe(
    Effect.mapError((error) => new InvalidHostRequest(key, error.message)),
  )) as Schema.Schema.Type<RequestSchemaOf<K>>;
});

function toProblem(error: unknown): {
  kind: HostErrorKind;
  message: string;
  status: number;
  nativeOutcome?: string;
  issues?: BridgeError["evidence"]["issues"];
  notDispatched?: true;
  result?: unknown;
  resolvedTarget?: BridgeError["evidence"]["resolvedTarget"];
} {
  if (
    error &&
    typeof error === "object" &&
    "problem" in error &&
    "status" in error &&
    "message" in error
  )
    return {
      kind: "InvalidRequest",
      message: String(error.message),
      status: Number(error.status),
    };
  if (error instanceof CommandRejected)
    return { kind: "InvalidRequest", message: error.message, status: 409 };
  if (error instanceof NoRevitSession)
    return { kind: "Disconnected", message: error.message, status: 503 };
  if (error instanceof StepFailure)
    return {
      kind: "HostFailure",
      message: error.message,
      status: error.status,
      ...(error.outcome === "refused" ? { notDispatched: true } : {}),
      result: error.result,
      nativeOutcome: error.details?.nativeOutcome,
      issues: error.details?.issues,
    };
  if (error instanceof PictureStoreFull)
    return { kind: "HostFailure", message: error.message, status: 409 };
  if (error instanceof Refused)
    return { kind: "InvalidRequest", message: error.message, status: 403, notDispatched: true };
  // BridgeError is a Schema.TaggedError (an Error) since ADR 0029 phase 3b; its _tag branch below owns it.
  if (error instanceof Error && !(error instanceof BridgeError))
    return { kind: "HostFailure", message: error.message, status: 500 };
  if (
    !(
      error instanceof BridgeError ||
      error instanceof InvalidHostRequest ||
      error instanceof LocalOpError
    )
  )
    return { kind: "HostFailure", message: String(error), status: 500 };
  switch (error._tag) {
    case "InvalidHostRequest":
      return { kind: "InvalidRequest", message: error.message, status: 400 };
    case "BridgeError":
      return {
        kind:
          error.statusCode === 423 &&
          (error.evidence.notDispatched || error.nativeOutcome === "RefusedQueueUnresponsive")
            ? "BridgeBusy"
            : error.statusCode === 503
              ? "Disconnected"
              : error.statusCode === 400
                ? "InvalidRequest"
                : "HostFailure",
        message: error.message,
        status: error.statusCode,
        nativeOutcome: error.nativeOutcome,
        issues: error.evidence.issues,
        notDispatched: error.evidence.dispatched ? undefined : error.evidence.notDispatched,
        result: error.evidence.result,
        resolvedTarget: error.evidence.resolvedTarget,
      };
    case "LocalOpError":
      return { kind: "HostFailure", message: error.message, status: localOpHttpStatus(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executeGatewayLocal(
  key: string,
  input: unknown,
  bridge: RevitBridge["Service"],
  captures: TakeoffCaptures,
  pictures: PictureCaptureStore["Service"],
  launch?: (path: string) => Promise<void>,
): Promise<unknown> {
  if (!isTsOnlyOperationKey(key))
    throw new BridgeError("Unknown host operation", 409, { notDispatched: true });
  if (!linkedCatalog().entries.get(key)?.call?.shell)
    // effect-edge: island, phase 5
    return Effect.runPromise(
      dispatchTsOnlyOperation(key, input, undefined, bridge, captures, {
        caller: { kind: "anonymous" },
      }).pipe(
        Effect.provide(NodeServices.layer),
        Effect.provide(NodeHttpClient.layerUndici),
        Effect.provideService(PictureCaptureStore, pictures),
      ),
    );
  // effect-edge: island, phase 5
  return Effect.runPromise(
    Effect.flatMap(decodeRequest("host.shell.open", input), (input) =>
      openShellPath(input, launch),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}
