import { blobUploadSchema } from "@pe/agent-contracts";
import { put as putBlob } from "./action-blobs.ts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { captureReceiptSchema } from "@pe/agent-contracts";
import { canonicalRouteInput, nativePrincipals } from "@pe/agent-contracts";
import {
  NATIVE_BODY_VERSION_HEADER,
  DUCTS_REFRESH_HEADER,
} from "@pe/agent-contracts";
import { actionControls, commandTool, receiptsForWork } from "@pe/agent-contracts";
import type { Caller } from "@pe/agent-contracts";
import { actionAdmissionSchema, workKeySchema } from "@pe/agent-contracts";
import {
  addressSchema,
  sameAddress,
  documentRefSchema,
  actionStatusSchema,
} from "@pe/agent-contracts";

import { peRoutes, linkedCatalog } from "@pe/agent-contracts/pe-api";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import type { HostErrorKind } from "@pe/host-contracts/contracts";
import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  isTsOnlyOperationKey,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";

import { HostNativeRead } from "@pe/host-internal/native-read";
import type { NativeReadInput } from "@pe/host-internal/native-read";

import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, type HttpServerRequest, HttpServerResponse as Response } from "effect/http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { nativeReadResolveEndpoint } from "../../../packages/agent-contracts/src/native-read-endpoint.ts";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "../../../packages/mcps/src/shared/takeoff-ops.ts";
import { ActionJournal } from "./action-journal.ts";
import { apsAuthLogin, apsAuthLogout, apsAuthStatus, apsAuthToken } from "./aps-auth.ts";
import { RevitBridge, BridgeError, NoRevitSession } from "./bridge.ts";
import {
  PictureCaptureStore,
  PictureStoreFull,
} from "./captures-route.ts";
import { CommandRejected, StepFailure } from "./command-executor.ts";
import { bindCommandRuntime } from "./command-registry.ts";
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
import { HostDocumentMarks } from "./document-marks.ts";
import { ductBodySubject, type DuctsBodyBasisSource } from "./ducts-body-basis.ts";
import { DuctFiles } from "./ducts-files.ts";
import type { DuctsReadings } from "./ducts-readings.ts";
import { ductsReadings } from "./ducts-readings.ts";

import type { FamiliesReader } from "./families-reader.ts";
import { readFamily, type FamilyActionDependencies } from "./family-actions.ts";
import { FamilyPdfParser } from "./family-spec.ts";
import { operationDefinition, gatewayTarget, requireEligibleCaller } from "./gateway-actions.ts";
import { httpProblems, isDoorFailure } from "./http-problems.ts";
import { HostInputContext } from "./input-context.ts";
import type { InstancesActionDependencies } from "./instances-actions.ts";
import { LocalOpError, localOpHttpStatus } from "./local-error.ts";
import {
  getBridgeSessionSummary,
  getHostStatus,
  listBridgeSessions,
  openShellPath,
  tailLogs,
} from "./local-ops.ts";
import { admitNativeCaller } from "./native-read-policy.ts";
import { InvalidRead } from "./native-reads.ts";
import { capturePackage } from "./packages.ts";
import { exportPod, importPod, promotePage, TransferRefused } from "./pod-transfer.ts";
import { recordHostFact } from "./receipt-export.ts";
import { ReadFreshness, RequestIdentity } from "./request-services.ts";
import {
  rhvacAssemblies,
  rhvacLaunch,
  rhvacList,
  rhvacOpen,
  rhvacSync,
  rhvacTakeoff,
} from "./rhvac-ops.ts";
import { readSchedule } from "./schedule-actions.ts";
import { sdkSession, SdkSession } from "./sdk-session.ts";
import type { HostSessionInventory } from "./session-inventory.ts";
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
import { fileVersion } from "./takeoff-actions.ts";
import { CaptureStore as TakeoffCaptureStore, type TakeoffCaptures } from "./takeoff-captures.ts";
import { pointerThread, type ThreadPointers } from "./thread-pointers.ts";

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
  actionDeps: FamilyActionDependencies & InstancesActionDependencies & {
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
    readonly retainedBasis?: DuctsBodyBasisSource;
    readonly retainedRead?: (input: NativeReadInput, options: { version?: string; refresh?: string }) => ReturnType<typeof retainedDuctsRead>;
    readonly nativeBody?: (input: NativeReadInput, read: ReturnType<typeof readNativeCall>) => Effect.Effect<{
      answer: Effect.Success<ReturnType<typeof readNativeCall>>;
    }, Effect.Error<ReturnType<typeof readNativeCall>>, Effect.Services<ReturnType<typeof readNativeCall>>>;
  },
) {
  const CALL_FORWARD_BASE = process.env.PE_TOOLS_CALL_FORWARD?.trim().replace(/\/$/, "");
  if (CALL_FORWARD_BASE || composition?.forwardBase)
    throw Error(
      "Host forwarding is disabled: execution requires this runtime's own host and Revit.",
    );
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
  const callDoor = peRoutes["operation.call"];
  const post = HttpRouter.add(callDoor.method, callDoor.path, (req) => {
    if (req.headers["x-pe-history-point"]) return Effect.succeed(Response.jsonUnsafe({ error: { code: "history.read-only", message: "needs live Revit" } }, { status: 409 }));
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
      const body = yield* nativeCallBody(req);
      const key = body.key;
      const inputs = yield* Effect.serviceOption(HostInputContext);
      if (inputs._tag === "Some") {
        const refusal = inputs.value.check({ kind: "native", key });
        if (refusal) return yield* refusal;
      }
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
      if (entry.canonicalSession && scope.bridgeSessionId && !(entry.reading && composition?.retainedRead)) {
        const bridgeForScope = yield* RevitBridge;
        const canonicalSession = yield* SdkSession.resolve(bridgeForScope, { id: scope.bridgeSessionId });
        scope = { ...scope, bridgeSessionId: canonicalSession.sessionId };
      }
      let bridgeSessionId = scope.bridgeSessionId;
      let openDocumentId: string | null | undefined = scope.openDocumentId;

      if (entry.saved) {
        op = { key, tsOnly: true, startedAt: Date.now(), origin, originClass, requestId };
        const value = yield* savedTakeoffs(request, observations());
        recordOperation(op, { ok: true });
        return Response.jsonUnsafe(value);
      }

      if (entry.reading && composition?.retainedRead) {
        const response = yield* composition.retainedRead({ key, input: request ?? {}, scope },
          { version: req.headers[NATIVE_BODY_VERSION_HEADER], refresh: req.headers[DUCTS_REFRESH_HEADER] });
        recordOperation({ key, tsOnly: false, startedAt: Date.now(), origin, originClass, requestId }, { ok: true });
        return response;
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
        const response = yield* retainedDuctsRead(ductsReadings(bridge), {
          key, input: request ?? {}, scope: { ...scope, bridgeSessionId: bridgeSessionId!, openDocumentId: openDocumentId ?? undefined },
        }, { version: req.headers[NATIVE_BODY_VERSION_HEADER], refresh: req.headers[DUCTS_REFRESH_HEADER] }, {
          basis: composition?.retainedBasis,
          document: (ref) => Effect.suspend(() => {
            const document = resolvedSession?.state?.openDocuments.find((doc) => doc.openId === ref.openId);
            return document && resolvedSession?.sessionId === ref.session
              ? Effect.succeed({ ...ref, address: addressSchema.nullable().parse(document.address ?? null) })
              : Effect.fail(new InvalidRead({ message: 'Exact Ducts document is unavailable', status: 409, problem: 'read.target' }));
          }),
        });
        recordOperation(op, { ok: true });
        return response;
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
                const input = { key, input: request ?? {}, scope: { ...scope, bridgeSessionId, openDocumentId: openDocumentId ?? undefined } };
                const read = readNativeCall(key, input.input, input.scope);
                const captured = composition?.nativeBody ? yield* composition.nativeBody(input, read) : { answer: yield* read };
                const answer = captured.answer;
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
      const kept = captureReceiptSchema.safeParse((result.value as {capture?:unknown}|null)?.capture).data;
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
  const familiesReadings = HttpRouter.add("GET", "/families/readings", (req) => {
    return RevitBridge.use(() =>
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
          throw Error("Unsupported Families reading method");
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
  const uploads = HttpRouter.add(peRoutes["blobs.put"].method, peRoutes["blobs.put"].path, (req) =>
    Effect.gen(function* () {
      const caller = currentCaller();
      if (caller.kind !== "human" && caller.kind !== "pea")
        return Response.jsonUnsafe({ error: "Upload requires a human or Pea caller" }, { status: 403 });
      if (req.headers["x-pe-history-point"])
        return Response.jsonUnsafe({ error: "History is read-only" }, { status: 409 });
      const body = yield* req.json;
      const input = yield* Effect.try({ try: () => blobUploadSchema.parse(body), catch: error => error });
      return Response.jsonUnsafe(yield* Effect.promise(() => putBlob(Buffer.from(input.base64, "base64"), input.fileName)));
    }).pipe(Effect.catch((error) => Effect.succeed(Response.jsonUnsafe({ error: String(error) }, { status: 400 })))),
  );
  const admitDoor = peRoutes["actions.admit"];
  const actions = HttpRouter.add(admitDoor.method, admitDoor.path, (req) =>
    Effect.gen(function* () {
      if (req.headers["x-pe-history-point"]) return Response.jsonUnsafe({ error: { code: "history.read-only", message: "needs live Revit" } }, { status: 409 });
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
      if (req.headers["x-pe-history-point"]) return Effect.succeed(Response.jsonUnsafe({ error: { code: "history.read-only", message: "needs live Revit" } }, { status: 409 }));
      const caller = currentCaller();
      return RevitBridge.use((_bridge) =>
        Effect.flatMap(req.json, (body) => Effect.tryPromise({
          try: async () => {
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
        })).pipe(
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
      Effect.flatMap(req.method === "POST" ? req.json : Effect.succeed<Schema.Json>(null), (body) => Effect.tryPromise({
        try: async () => {
          if (req.method === "POST") {
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
      })).pipe(
        Effect.catch((error) =>
          Effect.succeed(Response.jsonUnsafe({ error: said(error) }, { status: 409 })),
        ),
      ),
    ),
  );
  const scheduleReadings = HttpRouter.add("POST", "/schedules/readings", (req) =>
    RevitBridge.use((bridge) =>
      Effect.flatMap(req.json, (body) => Effect.tryPromise({
        try: async () => {
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
      })).pipe(
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
          const parser = Option.getOrUndefined(yield* Effect.serviceOption(FamilyPdfParser));
          actionDeps = { ...actionDeps, ...(parser ? { parsePdf: parser.parse } : {}), marks: yield* HostDocumentMarks, pictures: yield* PictureCaptureStore, files: yield* DuctFiles };
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
    nativeReadResolveRoute.pipe(Layer.provide(httpProblems)),
    familiesReadings,
    captured,
    uploads,
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
    // TODO: migrate live-only topology inventory to HostSessionInventory; historical mount omits localEntries.
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
    // TODO: migrate this live-only caller to HostSessionInventory; historical /call never dispatches localEntries.
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

export const nativeReadResolveRoute = HttpRouter.add(
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

/** One native read operation path; callers keep their existing RequestIdentity. */
const readNativeCall = (key: string, input: unknown, scope: HostSessionScope) =>
  HostNativeRead.use((reads) => reads.read({ key, input, scope }));

/** The retained acquisition path shared by live /call and explicit historical read sets. */
export const retainedDuctsRead = Effect.fn("Call.retainedDucts")(function* (
  owner: DuctsReadings,
  rawInput: NativeReadInput,
  options: { version?: string; refresh?: string },
  source: { document: HostSessionInventory["Service"]["document"]; basis?: DuctsBodyBasisSource },
) {
  const native = yield* HostNativeRead;
  const input: NativeReadInput = { ...rawInput, scope: JSON.parse(JSON.stringify(rawInput.scope)) };
  // Replay admits the caller before reading a failed basis; it has no native acquisition to resolve.
  const replaying = source.basis?.replaying;
  if (replaying) yield* admitNativeCaller(input.key);
  const resolved = !replaying ? yield* native.resolve(input) : undefined;
  const subject = yield* Effect.try({ try: () => ductBodySubject(input), catch: (error) =>
    isDoorFailure(error) ? error : new InvalidRead({ message: said(error), status: 400, problem: "read.input" }) });
  const basis = source.basis ? yield* source.basis.prepare(input, subject) : undefined;
  const admitted = resolved ?? (yield* native.resolve(input));
  const target = { processIncarnation: admitted.processIncarnation, openDocumentLifetime: admitted.openDocumentLifetime };
  const shared = yield* owner.read(subject, Effect.gen(function* () {
    const answer = yield* native.read(input);
    if (canonicalRouteInput(answer.actualTarget) !== canonicalRouteInput(target))
      return yield* new InvalidRead({ message: "Ducts native response changed its admitted target", status: 409, problem: "read.target" });
    const actual = answer.actualTarget.openDocumentLifetime;
    // A cold historical owner reconstructs the original retained body, including its admitted
    // target metadata. A live hit did not consume another inventory row to record for this child.
    const capturedTarget = basis?.recorded?.target;
    const document = !capturedTarget && "openId" in actual
      ? yield* source.document({ session: input.scope.bridgeSessionId!, openId: actual.openId }) : undefined;
    const nativeTakingId = basis ? yield* basis.link(answer) : undefined;
    return { value: answer.value, nativeRequestId: answer.nativeRequestId, nativeTakingId,
      target: capturedTarget ?? { session: input.scope.bridgeSessionId!, document: document?.address ?? null,
        ...(document ? { documentRef: { session: document.session, openId: document.openId } } : {}) } };
  }), { ...options, ...(basis ? { source: {
    revision: basis.recorded?.version,
    beforeReady: (body) => basis.consume(body, target),
  } } : {}) }).pipe(Effect.catch((error) =>
    basis && options.version && error._tag === "InvalidRequest" &&
      error.status === 409 && error.problem === "read.retained"
      ? basis.refuse(error) : Effect.fail(error)));
  if (basis && shared.reused) yield* basis.consume(shared, target);
  yield* Effect.try({ try: () => owner.assertCurrent(subject, shared.version), catch: retainedReadFailure });
  return Response.text(shared.json, { headers: { "content-type": "application/json",
    ...resolvedTargetHeaders(shared.target), "x-pe-native-request-id": shared.nativeRequestId,
    [NATIVE_BODY_VERSION_HEADER]: shared.version, "x-pe-ducts-reused": String(shared.reused) } });
});

// The legacy retained owner uses statusCode; the typed HTTP mapper consumes status.
const retainedReadFailure = (error: unknown) => isDoorFailure(error) ? error : new InvalidRead({
  message: said(error), status: error instanceof BridgeError ? error.statusCode : 409, problem: "read.retained",
});

/** The same native door without live target/cache acquisition. Unsupported sources refuse first. */
export const nativeCallRouteFor = (retained?: (input: NativeReadInput, options: {version?:string;refresh?:string}) => ReturnType<typeof retainedDuctsRead>,
  normal?: (input: NativeReadInput) => ReturnType<typeof retainedDuctsRead>) => HttpRouter.add("POST", peRoutes["operation.call"].path, (req) =>
  Effect.gen(function* () {
    if (req.headers["x-pe-history-point"]) return yield* new InvalidRead({ message: "needs live Revit", status: 409, problem: "history.read-only" });
    const identity = yield* RequestIdentity;
    const body = yield* nativeCallBody(req);
    const inputs = yield* HostInputContext;
    const refusal = inputs.check({ kind: "native", key: body.key });
    if (refusal) return yield* refusal;
    // Retained Ducts HTTP bodies also need source metadata and version ownership, not just a native taking.
    if (linkedCatalog().entries.get(body.key)?.call?.reading) {
      if (retained) return yield* retained({ key: body.key, input: body.request ?? {}, scope: identity.scope },
        { version: req.headers[NATIVE_BODY_VERSION_HEADER], refresh: req.headers[DUCTS_REFRESH_HEADER] });
      const missing = inputs.check({ kind: "input", input: "document" });
      if (missing) return yield* missing;
    }
    if (normal) return yield* normal({ key: body.key, input: body.request ?? {}, scope: identity.scope });
    const answer = yield* readNativeCall(body.key, body.request ?? {}, identity.scope);
    return Response.jsonUnsafe(answer.value, { headers: { "x-pe-native-request-id": answer.nativeRequestId } });
  }).pipe(Effect.catch((error) => {
    if (isDoorFailure(error)) return Effect.fail(error);
    const problem = toProblem(error);
    return Effect.succeed(Response.jsonUnsafe(problem, { status: problem.status, headers: { "content-type": "application/problem+json" } }));
  })),
);
export const nativeCallRoute = nativeCallRouteFor();

const nativeCallBody = (req: HttpServerRequest.HttpServerRequest) => Effect.gen(function* () {
  const body = yield* req.json.pipe(Effect.mapError(() => invalidBody("unreadable JSON body")));
  if (!isRecord(body) || typeof body.key !== "string") return yield* Effect.fail(invalidBody("body must be { key: string, request?: object }"));
  const unknown = Object.keys(body).find((key) => key !== "key" && key !== "request");
  if (unknown) return yield* Effect.fail(invalidBody(unknownBodyKeyMessage(unknown)));
  return { key: body.key, request: body.request };
});
