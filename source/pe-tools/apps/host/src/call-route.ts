import { admitScheduleAction, recoverScheduleAction, readSchedule } from "./schedule-actions.ts";
import { admitInstancesAction, recoverInstancesAction } from "./instances-actions.ts";
import { instancesActions } from "@pe/agent-contracts";
import { actionControls, semanticActions } from "@pe/agent-contracts";
import { NodeHttpClient, NodeServices } from "@effect/platform-node";
import { hostActionJournal } from "./gateway-owner.ts";
import {
  admitGatewayAction,
  recoverGatewayAction,
  operationDefinition,
  gatewayTarget,
} from "./gateway-actions.ts";
import { actionBasesSchema, actionListFilterSchema } from "@pe/agent-contracts";
import {
  admitFamilyAction,
  recoverFamilyAction,
  readFamily,
  type FamilyActionDependencies,
} from "./family-actions.ts";
import {
  familyActions,
  actionAdmissionSchema,
  memberWork,
  scheduleActions,
  workKeySchema,
} from "@pe/agent-contracts";
import { admitTakeoffAction, recoverTakeoffAction, fileVersion } from "./takeoff-actions.ts";
import { takeoffActions } from "@pe/agent-contracts";
import { Effect, Layer, Schema } from "effect";
import {
  addressSchema,
  sameAddress,
  documentRefSchema,
  actionStatusSchema,
} from "@pe/agent-contracts";
import { hostTakeoffCaptures, type TakeoffCaptures } from "./takeoff-captures.ts";
import {
  projectTakeoffSnapshot,
  projectTakeoffViews,
  takeoffProjectIndexRequest,
} from "../../../packages/mcps/src/shared/takeoff-ops.ts";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
import { ActionJournal } from "./action-journal.ts";
import { boundedPayload, capture } from "@pe/runtime";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import {
  RevitBridge,
  BridgeError,
  CANCEL_OPERATION_KEY,
  NoRevitSession,
  type BridgeSessionView,
} from "./bridge.ts";
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
  listRuns,
  readMember,
  saveMember,
  writeMember,
  type PodContext,
} from "./settings.ts";
import { LocalOpError, localOpHttpStatus } from "./local-error.ts";
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
  tsOnlyOperationCatalog,
  tsOnlyOperationSchemas,
  type TsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import type { HostErrorKind } from "@pe/host-contracts/contracts";

/** A refusal's own words. `BridgeError` is a plain class, so `String()` would say [object Object]. */
const said = (error: unknown): string =>
  error !== null && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);

/**
 * The entire browser/CLI-facing wire: POST /call { key, request? } → JSON.
 * TS-only ops dispatch locally; every other key passes through to the bridge
 * untouched — the Revit side owns validation, so runtime-registered ops need
 * zero host changes. Errors are problem-JSON with a real HTTP status.
 */
// ponytail: dev-only escape — PE_TOOLS_CALL_FORWARD=<base-url> makes this host a pure
// /call proxy (e.g. to the installed host that owns the Revit bridge) while still serving
// the checkout's web UI with HMR. Delete when an installed-lane session can dial a dev host.

export type CallRouteDispatch = (
  ...args: Parameters<typeof dispatchTsOnlyOperation>
) => Effect.Effect<
  unknown,
  Effect.Error<ReturnType<typeof dispatchTsOnlyOperation>>,
  Effect.Services<ReturnType<typeof dispatchTsOnlyOperation>>
>;

export function makeCallRoute(
  operations?: ActionJournal,
  captures?: TakeoffCaptures,
  actionDeps: FamilyActionDependencies & { launchShell?: (path: string) => Promise<void> } = {},
  composition?: {
    readonly forwardBase: string | null;
    readonly dispatch: CallRouteDispatch;
    readonly captureHostOp?: typeof captureHostOp;
    readonly local?: Parameters<typeof admitGatewayAction>[3];
  },
) {
  const CALL_FORWARD_BASE = process.env.PE_TOOLS_CALL_FORWARD?.trim().replace(/\/$/, "");
  const captureOperation = composition?.captureHostOp ?? captureHostOp;
  const forwardBase = composition ? composition.forwardBase : CALL_FORWARD_BASE;
  const dispatch: CallRouteDispatch = (...args) =>
    (composition?.dispatch ?? dispatchTsOnlyOperation)(...args);
  const observations = () => (captures ??= hostTakeoffCaptures());
  const owner = () => (operations ??= hostActionJournal());
  const admit = (raw: unknown, bridge: RevitBridge["Service"], resume = false) => {
    const input = actionAdmissionSchema.parse(raw);
    return input.kind === "workflow" && Object.hasOwn(scheduleActions, input.key)
      ? admitScheduleAction(input, owner(), observations(), bridge, actionDeps, resume)
      : input.kind === "workflow" && Object.hasOwn(instancesActions, input.key)
        ? admitInstancesAction(input, owner(), actionDeps, resume)
        : input.kind === "workflow" && Object.hasOwn(familyActions, input.key)
          ? admitFamilyAction(input, owner(), observations(), bridge, actionDeps, resume)
          : input.kind === "workflow" && Object.hasOwn(takeoffActions, input.key)
            ? admitTakeoffAction(input, owner(), observations(), bridge, actionDeps, resume)
            : admitGatewayAction(
                input,
                owner(),
                bridge,
                composition?.local ??
                  ((key, input) => executeGatewayLocal(key, input, bridge, actionDeps.launchShell)),
                actionDeps.sdk,
                resume,
              );
  };
  const post = HttpRouter.add("POST", "/call", (req) => {
    let captureId: string | undefined;
    // Set once dispatch begins so the catch below can attribute failures to the op.
    let op:
      | { key: string; request: unknown; tsOnly: boolean; startedAt: number; origin: string }
      | undefined;
    return Effect.gen(function* () {
      // Lenient by ruling (queue-provenance §1): origin is attribution, not authorization —
      // a missing header is counted as "unknown", never rejected. No registry, no validation.
      const origin = req.headers[HOST_RPC_ORIGIN_HEADER]?.trim() || "unknown";
      const body = yield* req.json.pipe(Effect.mapError(() => invalidBody("unreadable JSON body")));
      if (forwardBase) {
        if (
          !isRecord(body) ||
          !tsOnlyOperationCatalog.some((row) => row.key === body.key && row.intent === "Read")
        )
          return yield* Effect.fail(
            new BridgeError(
              "Forwarded native/mutation calls require the integrated admission host",
              409,
              { notDispatched: true },
            ),
          );
        const sessionHeader = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim();
        const documentHeader = req.headers[HOST_RPC_DOCUMENT_HEADER]?.trim();
        const forwarded = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${forwardBase}/call`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(sessionHeader ? { [HOST_RPC_BRIDGE_SESSION_HEADER]: sessionHeader } : {}),
                ...(documentHeader ? { [HOST_RPC_DOCUMENT_HEADER]: documentHeader } : {}),
                [HOST_RPC_ORIGIN_HEADER]: origin, // provenance survives the dev proxy hop
              },
              body: JSON.stringify(body),
            });
            return {
              status: response.status,
              json: (await response.json()) as unknown,
              headers: Object.fromEntries(
                [
                  RESOLVED_SESSION_HEADER,
                  RESOLVED_DOCUMENT_HEADER,
                  "x-pe-takeoff-capture-id",
                ].flatMap((key) => {
                  const value = response.headers.get(key);
                  return value ? [[key, value]] : [];
                }),
              ),
            };
          },
          catch: (cause) =>
            new BridgeError(`call forward to ${forwardBase} failed: ${String(cause)}`, 503),
        });
        // Merge this checkout's TS-only catalog entries into a forwarded catalog so the ops
        // page lists both surfaces (the forward target may run an older TS-only set).
        if (isRecord(body) && body.key === "host.ops.catalog" && forwarded.status === 200) {
          const catalog = forwarded.json as { operations?: { key?: string }[] };
          if (Array.isArray(catalog.operations)) {
            const seen = new Set(catalog.operations.map((op) => op.key));
            catalog.operations.push(
              ...tsOnlyOperationCatalog.filter((entry) => !seen.has(entry.key)),
            );
          }
        }
        return Response.jsonUnsafe(forwarded.json ?? null, {
          status: forwarded.status,
          headers: forwarded.headers,
        });
      }
      if (!isRecord(body) || typeof body.key !== "string")
        return yield* Effect.fail(invalidBody("body must be { key: string, request?: object }"));
      // The /call envelope is exactly { key, request? }. Reject any other top-level key so
      // silently-ignored fields can't mis-target: a `bridgeSessionId` in the body once routed a
      // call to the user's live Revit — session targeting travels ONLY in the header.
      const unknownKey = Object.keys(body).find((k) => k !== "key" && k !== "request");
      if (unknownKey) return yield* Effect.fail(invalidBody(unknownBodyKeyMessage(unknownKey)));
      const key = body.key;
      const request = "request" in body ? body.request : undefined;
      let bridgeSessionId = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER]?.trim() || undefined;
      let openDocumentId: string | null | undefined =
        req.headers[HOST_RPC_DOCUMENT_HEADER]?.trim() || undefined;

      if (key === "takeoffs.saved") {
        op = { key, request, tsOnly: true, startedAt: Date.now(), origin };
        const value = yield* savedTakeoffs(request, observations());
        captureOperation(op, { ok: true });
        return Response.jsonUnsafe(value);
      }

      if (key === "host.ops.catalog") openDocumentId = null;
      const bridge = yield* RevitBridge;
      // Endpoint-level backstop for the data-loss path: an untargeted Revit op with several sessions
      // connected must never fall through to one of them. bridge.invoke also hard-fails here, but its
      // hint speaks the MCP `target=` selector; at the raw wire the fix is the header, so name it.
      if (!isTsOnlyOperationKey(key) && !bridgeSessionId) {
        const sessions = yield* bridge.list;
        if (sessions.length > 1) return yield* Effect.fail(ambiguousBridgeTarget(sessions));
      }
      op = { key, request, tsOnly: isTsOnlyOperationKey(key), startedAt: Date.now(), origin };
      if (key !== "takeoffs.snapshot" && key !== "host.ops.catalog") {
        const definition = yield* Effect.tryPromise({
          try: () => operationDefinition(key, bridge, bridgeSessionId),
          catch: (error) => error,
        });
        if (definition.intent === "Mutate") {
          return yield* Effect.fail(
            new BridgeError(
              "Submit the original exact admission to /actions; raw mutation dispatch is retired",
              409,
              { notDispatched: true },
            ),
          );
        }
        if (definition.intent !== "Read")
          return yield* Effect.fail(
            new BridgeError("Unknown operation intent", 409, { notDispatched: true }),
          );
        if (!isTsOnlyOperationKey(key)) {
          const target = yield* Effect.tryPromise({
            try: () =>
              gatewayTarget(
                key,
                definition.needs,
                bridge,
                bridgeSessionId,
                openDocumentId ?? undefined,
              ),
            catch: (error) => error,
          });
          if (target.kind !== "host")
            bridgeSessionId = target.kind === "document" ? target.ref.session : target.session;
          openDocumentId = target.kind === "document" ? target.ref.openId : null;
        }
      }
      const result = isTsOnlyOperationKey(key)
        ? {
            value: yield* dispatch(key, request, bridgeSessionId, bridge),
            target: null,
          }
        : key === "takeoffs.snapshot"
          ? yield* Effect.tryPromise({
              try: async () => {
                const target = documentRefSchema.parse({
                  session: bridgeSessionId,
                  openId: openDocumentId,
                });
                const selected = async () => {
                  const sessions = await Effect.runPromise(bridge.list);
                  return sessions
                    .find((session) => session.sessionId === target.session)
                    ?.state?.openDocuments.find((document) => document.openId === target.openId);
                };
                const document = await selected();
                if (!document?.address)
                  throw new BridgeError("Snapshot requires an exact open saved document", 409);
                const at = addressSchema.parse(document.address);
                const published = await observations().refresh(
                  target,
                  async () => {
                    const [result, index] = await Promise.all([
                      Effect.runPromise(
                        bridge.invoke(key, request ?? {}, target.session, target.openId),
                      ),
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
          : yield* bridge.invoke(key, request ?? {}, bridgeSessionId, openDocumentId);
      captureOperation(op, { ok: true });
      // Every /call response names the target it actually ran against, so a tool card can show
      // what was touched rather than the selector that was typed. Headers, not a payload wrapper.
      // A TS-only op touched no Revit, so it stamps nothing rather than the latest session.
      const headers = result.target ? resolvedTargetHeaders(result.target) : {};
      if (captureId) headers["x-pe-takeoff-capture-id"] = captureId;
      return Response.jsonUnsafe(result.value ?? null, { headers });
    }).pipe(
      Effect.catch((error) => {
        if (op) captureOperation(op, { ok: false, problem: toProblem(error) });
        return Effect.succeed(
          Response.jsonUnsafe(toProblem(error), {
            status: toProblem(error).status,
            headers: { "content-type": "application/problem+json" },
          }),
        );
      }),
    );
  });
  const captured = HttpRouter.add("GET", "/takeoffs/observations", (req) =>
    Effect.tryPromise({
      try: async () => {
        const query = new URL(req.url, "http://host").searchParams;
        if (forwardBase) {
          const response = await fetch(`${forwardBase}${req.url}`, {
            headers: {
              [HOST_RPC_BRIDGE_SESSION_HEADER]: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER] ?? "",
              [HOST_RPC_DOCUMENT_HEADER]: req.headers[HOST_RPC_DOCUMENT_HEADER] ?? "",
            },
          });
          return Response.jsonUnsafe(await response.json(), { status: response.status });
        }
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
  const actions = HttpRouter.add("POST", "/actions", (req) =>
    Effect.gen(function* () {
      const body = yield* req.json;
      if (forwardBase)
        return Response.jsonUnsafe(
          { error: "Mutation forwarding is not admitted by this host", notDispatched: true },
          { status: 409 },
        );
      const bridge = yield* RevitBridge;
      const row = yield* Effect.tryPromise({
        try: () => admit(body, bridge),
        catch: (error) => error,
      });
      return Response.jsonUnsafe(row, { status: row.state === "running" ? 202 : 200 });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Response.jsonUnsafe(
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
  const actionReads = HttpRouter.add("GET", "/actions", (req) =>
    Effect.tryPromise({
      try: async () => {
        const query = new URL(req.url, "http://host").searchParams;
        if (forwardBase) {
          const forwarded = await fetch(`${forwardBase}${req.url}`, {
            headers: {
              [HOST_RPC_BRIDGE_SESSION_HEADER]: req.headers[HOST_RPC_BRIDGE_SESSION_HEADER] ?? "",
              [HOST_RPC_DOCUMENT_HEADER]: req.headers[HOST_RPC_DOCUMENT_HEADER] ?? "",
            },
          });
          return Response.jsonUnsafe(await forwarded.json(), { status: forwarded.status });
        }
        if (query.has("file")) {
          const path = query.get("file")!;
          return Response.jsonUnsafe({
            path,
            fileVersion: await (actionDeps.fileVersion ?? fileVersion)(path),
          });
        }
        const session = req.headers[HOST_RPC_BRIDGE_SESSION_HEADER],
          openId = req.headers[HOST_RPC_DOCUMENT_HEADER];
        const target = session && openId ? documentRefSchema.parse({ session, openId }) : undefined;
        let rows = await owner().list(target, query.get("id") ?? undefined);
        if (query.has("kind")) rows = rows.filter((row) => row.kind === query.get("kind"));
        if (query.has("scope")) {
          if (query.has("id")) throw Error("Choose original ID or subject listing");
          const scope = actionListFilterSchema.parse(JSON.parse(query.get("scope")!));
          const selected = [];
          for (const row of rows) {
            if (row.kind !== "workflow") continue;
            if (
              !["running", "unknown", "incomplete"].includes(row.state) &&
              row.id !== query.get("include")
            )
              continue;
            const workScope = actionBasesSchema.safeParse(row.bases).data?.work?.key;
            if (scope.kind === "schedules") {
              if (
                row.key === "schedule.grid.push" &&
                // The Work key names its workspace as `work` since fold-1; the filter still speaks
                // the domain word `workspaceId`.
                workScope?.work === scope.workspaceId
              )
                selected.push(row);
              continue;
            }
            if (scope.kind === "instances") {
              if (
                Object.hasOwn(instancesActions, row.key) &&
                row.request.workspaceId === scope.workspaceId
              )
                selected.push(row);
              continue;
            }
            const member = (row.request.member ?? row.request.source) as
              | { pod: string; path: string }
              | undefined;
            const work = member ? memberWork(member) : undefined;
            if (row.key === "settings.write" && work === scope.workspaceId) selected.push(row);
            else if (
              row.destination.kind === "document" &&
              (scope.kind === "family-file" ||
                (scope.kind === "family" &&
                  row.destination.ref.session === scope.target.session &&
                  row.destination.ref.openId === scope.target.openId)) &&
              (row.key === "family.build" || row.key === "family.apply") &&
              work === scope.workspaceId
            )
              selected.push(row);
          }
          rows = selected;
        }
        return Response.jsonUnsafe(query.has("id") ? rows : actionStatusSchema.array().parse(rows));
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Response.jsonUnsafe({ error: String(error) }, { status: 400 })),
      ),
    ),
  );
  // action.read is GET /actions; every other control is POST /actions/<verb>, the path the client builds.
  const controlVerbs = Object.keys(actionControls)
    .filter((key) => key !== "action.read")
    .map((key) => key.slice("action.".length));
  const controls = controlVerbs.map((choice) =>
    HttpRouter.add("POST", `/actions/${choice}`, (req) =>
      RevitBridge.use((bridge) =>
        Effect.tryPromise({
          try: async () => {
            const body = await Effect.runPromise(req.json);
            if (!isRecord(body) || typeof body.id !== "string")
              throw Error("An original action ID is required");
            if (forwardBase)
              throw Error(
                "Action controls require the exact owning host journal; forwarding is unsupported",
              );
            const controlled = (await owner().list(undefined, body.id))[0];
            if (body.kind !== undefined && body.kind !== controlled?.kind)
              throw Error("Original admission kind mismatch");
            if (body.actor !== undefined) {
              if (body.actor !== "human" && body.actor !== "agent")
                throw Error("Explicit control actor invalid");
              const required =
                controlled?.kind === "workflow"
                  ? semanticActions[controlled.key as keyof typeof semanticActions]?.actor
                  : controlled?.preparation.state === "ready"
                    ? (controlled.preparation.value as { actor?: string }).actor
                    : undefined;
              if (required && required !== "any" && required !== body.actor)
                throw Error("Control actor is not eligible for the original admission");
            }
            if (choice === "cancel")
              return Response.jsonUnsafe(
                await owner().cancel(body.id, async (requestId) => {
                  const { value } = await Effect.runPromise(
                    bridge
                      .invoke(CANCEL_OPERATION_KEY, { requestId })
                      .pipe(Effect.catchCause(Effect.failCause)) as Effect.Effect<
                      { value: unknown },
                      unknown
                    >,
                  );
                  // Revit answers 200 even when the id is not in flight; that is a refusal, not a stop.
                  const answer = value as { cancelled?: boolean; message?: string } | null;
                  if (answer?.cancelled === false) throw Error(answer.message);
                }),
                { status: 202 },
              );
            if (choice === "recover") {
              const original = (await owner().list(undefined, body.id))[0];
              return Response.jsonUnsafe(
                await (original?.kind === "workflow" && Object.hasOwn(scheduleActions, original.key)
                  ? recoverScheduleAction(body.id, owner(), actionDeps)
                  : original?.kind === "workflow" && Object.hasOwn(instancesActions, original.key)
                    ? recoverInstancesAction(body.id, owner(), actionDeps)
                    : original?.kind === "workflow" && Object.hasOwn(familyActions, original.key)
                      ? recoverFamilyAction(body.id, owner(), actionDeps)
                      : original?.kind === "workflow" && Object.hasOwn(takeoffActions, original.key)
                        ? recoverTakeoffAction(body.id, owner(), actionDeps)
                        : recoverGatewayAction(body.id, owner(), actionDeps.sdk)),
              );
            }
            // A control added to actionControls gets a route before it gets a handler.
            if (choice !== "resume") throw Error(`Action control '${choice}' has no handler`);
            const prior = (await owner().list(undefined, body.id))[0];
            if (!prior) throw Error("Original action has no resumable authored admission");
            const row = await admit(
              {
                id: prior.id,
                kind: prior.kind,
                key: prior.key,
                actor: prior.actor,
                destination: prior.destination,
                input: prior.request,
                bases: prior.bases,
              },
              bridge,
              true,
            );
            return Response.jsonUnsafe(row, { status: row.state === "running" ? 202 : 200 });
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed(Response.jsonUnsafe({ error: said(error) }, { status: 409 })),
          ),
        ),
      ),
    ),
  );
  const familyReadings = HttpRouter.add("*", "/family/readings", (req) =>
    RevitBridge.use((bridge) =>
      Effect.tryPromise({
        try: async () => {
          if (forwardBase) {
            const response = await fetch(`${forwardBase}${req.url}`, {
              method: req.method,
              ...(req.method === "POST"
                ? {
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(await Effect.runPromise(req.json)),
                  }
                : {}),
            });
            return Response.jsonUnsafe(await response.json(), { status: response.status });
          }
          if (req.method === "POST") {
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
          if (forwardBase) throw Error("Schedule readings require their exact owning host");
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
    post,
    captured,
    actions,
    actionReads,
    familyReadings,
    scheduleReadings,
    ...controls,
  );
}

export const callRoute = makeCallRoute();

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

/** The host_op event: input, outcome, duration. Outputs are deliberately NOT captured —
 * they doubled event volume for no diagnostic value (the op key + input reproduce them);
 * failures carry the problem message instead. */
function captureHostOp(
  op: { key: string; request: unknown; tsOnly: boolean; startedAt: number; origin: string },
  outcome: { ok: true } | { ok: false; problem: { kind: string; message: string } },
): void {
  const input = boundedPayload(op.request ?? null);
  capture("host_op", {
    op: op.key,
    origin: op.origin,
    ts_only: op.tsOnly,
    ok: outcome.ok,
    error_kind: outcome.ok ? undefined : outcome.problem.kind,
    error_message: outcome.ok ? undefined : outcome.problem.message,
    duration_ms: Date.now() - op.startedAt,
    input: input.json,
    input_truncated: input.truncated,
    input_bytes: input.bytes,
  });
}

export const RESOLVED_SESSION_HEADER = "x-pe-resolved-session";
export const RESOLVED_DOCUMENT_HEADER = "x-pe-resolved-document";

function resolvedTargetHeaders({
  session,
  document,
}: {
  session: string;
  document: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  headers[RESOLVED_SESSION_HEADER] = session;
  if (document) headers[RESOLVED_DOCUMENT_HEADER] = encodeURIComponent(document);
  return headers;
}

export class InvalidHostRequest {
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

/** Untargeted Revit op with multiple sessions connected — refuse rather than route to one. */
function ambiguousBridgeTarget(sessions: readonly BridgeSessionView[]): BridgeError {
  const ids = sessions.map((s) => s.sessionId ?? "(unknown)").join(", ");
  return new BridgeError(
    `Multiple Revit sessions are connected (${ids}); untargeted Revit operations are ambiguous and refused. Set the '${HOST_RPC_BRIDGE_SESSION_HEADER}' header to target one.`,
    409,
  );
}

export const dispatchTsOnlyOperation = Effect.fnUntraced(function* (
  key: TsOnlyOperationKey,
  request: unknown,
  bridgeSessionId: string | undefined,
  bridge: RevitBridge["Service"],
) {
  switch (key) {
    case "takeoffs.saved":
      return yield* savedTakeoffs(request, hostTakeoffCaptures());
    case "host.status":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), (snapshot) =>
        getHostStatus(snapshot),
      );
    case "host.topology": {
      // The operator's map: host identity + all sessions in one snapshot (ADR 0003).
      const host = yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), (snapshot) =>
        getHostStatus(snapshot),
      );
      const sessions = yield* listBridgeSessions(bridge.list);
      return {
        observedAtUtc: new Date().toISOString(),
        host,
        sessions: sessions.sessions,
      };
    }
    case "bridge.sessions.summary":
      return yield* Effect.flatMap(bridge.snapshot(bridgeSessionId), getBridgeSessionSummary);
    case "bridge.sessions.list":
      return yield* listBridgeSessions(bridge.list);
    case "logs.tail":
      return yield* tailLogs(yield* decodeRequest(key, request));
    case "host.shell.open":
      return yield* openShellPath(yield* decodeRequest(key, request));
    case "pod.list":
      return yield* listPods();
    case "pod.runs":
      return yield* listRuns(yield* decodeRequest(key, request));
    case "pod.member.read":
      return yield* readMember(yield* decodeRequest(key, request));
    case "pod.member.write":
      return yield* writeMember(yield* decodeRequest(key, request));
    case "pod.member.save":
      return yield* saveMember(yield* decodeRequest(key, request));
    case "pod.member.compose":
      return yield* composeMember(
        yield* decodeRequest(key, request),
        yield* podContext(bridge, bridgeSessionId),
      );
    case "rhvac.open":
      return yield* rhvacOpen(yield* decodeRequest(key, request));
    case "rhvac.assemblies":
      return yield* rhvacAssemblies(yield* decodeRequest(key, request));
    case "rhvac.sync":
      return yield* rhvacSync(yield* decodeRequest(key, request));
    case "rhvac.launch":
      return yield* rhvacLaunch(yield* decodeRequest(key, request));
    case "rhvac.takeoff":
      return yield* rhvacTakeoff(yield* decodeRequest(key, request));
    case "rhvac.list":
      return yield* rhvacList(yield* decodeRequest(key, request));
    case "aps.auth.status":
      return yield* apsAuthStatus(yield* decodeRequest(key, request));
    case "aps.auth.login":
      return yield* apsAuthLogin(yield* decodeRequest(key, request));
    case "aps.auth.logout":
      return yield* apsAuthLogout();
    case "aps.auth.token":
      return yield* apsAuthToken(yield* decodeRequest(key, request));
  }
});

/** A session-less host composes schema-only; it never pretends a bridge is there. */
const podContext = Effect.fnUntraced(function* (
  bridge: RevitBridge["Service"],
  bridgeSessionId: string | undefined,
) {
  const session = yield* bridge.snapshot(bridgeSessionId);
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
  resolvedTarget?: BridgeError["evidence"]["resolvedTarget"];
} {
  if (error instanceof Error) return { kind: "HostFailure", message: error.message, status: 500 };
  if (
    !(
      error instanceof BridgeError ||
      error instanceof InvalidHostRequest ||
      error instanceof LocalOpError ||
      error instanceof NoRevitSession
    )
  )
    return { kind: "HostFailure", message: String(error), status: 500 };
  switch (error._tag) {
    case "InvalidHostRequest":
      return { kind: "InvalidRequest", message: error.message, status: 400 };
    case "NoRevitSession":
      return { kind: "Disconnected", message: error.message, status: 503 };
    case "BridgeError":
      if (error.message.startsWith("Unsupported bridge operation '"))
        return {
          kind: "CatalogLookup",
          message: `${error.message} Discover product operation keys with pe_find.`,
          status: 404,
          nativeOutcome: error.nativeOutcome,
          issues: error.evidence.issues,
          resolvedTarget: error.evidence.resolvedTarget,
        };
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
        notDispatched: error.evidence.notDispatched,
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
  launch?: (path: string) => Promise<void>,
): Promise<unknown> {
  if (!isTsOnlyOperationKey(key))
    throw new BridgeError("Unknown host operation", 409, { notDispatched: true });
  if (key !== "host.shell.open")
    return Effect.runPromise(
      dispatchTsOnlyOperation(key, input, undefined, bridge).pipe(
        Effect.provide(NodeServices.layer),
        Effect.provide(NodeHttpClient.layerUndici),
      ),
    );
  return Effect.runPromise(
    Effect.flatMap(decodeRequest("host.shell.open", input), (input) =>
      openShellPath(input, launch),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}
