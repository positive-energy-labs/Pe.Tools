import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import {
  applicationWorkRegistry,
  createApplicationWorkRegistry,
} from "./application-work-registry";
import { routeWorkSubject } from "../../../../packages/agent-contracts/src/route-work-subject";
import { commandResultDecoder, type CommandResultDecode } from "./admitted-command-result";
import type { InvocationToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { peReadings } from "../readings";
import { OLDER_WORK, UNREADABLE_WORK } from "@pe/agent-contracts";
import { startFreshRouteWork, salvageRouteWork } from "../route/host";
import { admittedWorkPatches } from "./admitted-cells";
import { createAdmittedCells } from "./admitted-cells";
import { z } from "zod";
import { placeAdmittedVerbs } from "./admitted-placement";
import { createAdmittedObservers } from "./admitted-observers";
import { reviewChanges } from "./review-value";
import {
  bindWork,
  workKey,
  workHandleSchema,
  writePreviewSchema,
  commands,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { createWorkJournal } from "../../../../packages/runtime/src/work-journal";
import { createWorkFeedClient } from "./work-feed-client";
import { createAdmittedWork } from "./admitted-work";
import { createAdmittedGeometry } from "./admitted-geometry";
import { fixtureName } from "./fixture-lane";
import { fixtureGeometryDoor } from "./fixture-geometry-door";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";

/** This mount door never translates an executable legacy graph. Recheck before every draw. */
export function mountAdmittedRoute(route: AdmittedRoute, expectedFingerprint: string) {
  if (route.fingerprint !== expectedFingerprint) throw Error("Stale route stamp at mount");
  const registry = createAdmittedRouteRegistry();
  const receipt = registry.register(route);
  return {
    resolve() {
      const bindings = resolveRouteBindings(registry, route);
      if (!bindings || route.fingerprint !== expectedFingerprint)
        throw Error("Stale or foreign route admission at mount");
      return { route, bindings };
    },
    close: () => receipt.deactivate(),
  };
}

/** Evaluate only the bytes the artifact verifier has checked. No URL remains owned. */
export async function evaluateRouteBytes(bytes: Uint8Array): Promise<unknown> {
  const url = `data:text/javascript;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
  return import(/* @vite-ignore */ url);
}
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type {
  SchemaTable,
  PagePort,
  FieldControls,
} from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { EntryTable } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import {
  createRouteEnvironmentIssuer,
  canonicalEnvironmentInput,
  type KernelServices,
  type ReadHandle,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createPagePolicy, createPagePorts, freezePage } from "./page-port";
import { createAdmittedAddress, type AdmittedAddressPort } from "./admitted-address";
import {
  createAdmittedReadingPlan,
  readingClosure,
  receiptHitsReading,
  type AdmittedReadingStatus,
} from "./admitted-reading-plan";
import { sourceReadingEvidence } from "./source-route-services";
import { createRouteEnvironment, type EnvironmentValidation } from "./route-environment";
import { createNamedFixtureRouteEnvironment, selectRouteEnvironment } from "./fixture-lane";

/** Closed slot census. Other kinds refuse before resource acquisition. */
export const admittedMountBodyKinds: readonly string[] = Object.freeze([
  "args",
  "adapter",
  "derive",
  "picker",
  "ready",
  "describe",
  "work",
  "intent",
  "lands",
  "page",
  "pane",
  "seed",
  "transition",
  "predicate",
  "show",
  "subject",
  "placement",
  "present",
  "group",
  "label",
  "focus",
  "take",
  "salvage",
  "migration",
]);

export class ReviewRefusal extends Error {
  readonly kind = "refused";
  constructor(readonly reason: "review-stale" | "present-threw" | "present-invalid") {
    super(
      reason === "review-stale" ? "Review is stale; prepare it again" : `Review refused: ${reason}`,
    );
    this.name = "ReviewRefusal";
  }
}
type PresentationEvidence = Readonly<{
  page: Readonly<Record<string, unknown>>;
  work: Readonly<Record<string, unknown>>;
  readings: Readonly<Record<string, ReadingSnapshot<unknown>>>;
}>;

/** Application services are installed once. Routes supply only admission and location. */
const applicationWorkDoor = createWorkFeedClient();
const sourceTimeline = new WeakMap<
  object,
  import("../../../../packages/runtime/src/work-journal").TimelineEntry[]
>();
const registriesByDoor = new WeakMap<object, ReturnType<typeof createApplicationWorkRegistry>>();
export function createRouteShell(
  services: KernelServices,
  registryOverride?: ReturnType<typeof createApplicationWorkRegistry>,
) {
  const liveDoor = services.work ?? applicationWorkDoor;
  let scopedRegistry = registriesByDoor.get(liveDoor);
  if (!scopedRegistry) {
    scopedRegistry = services.work ? createApplicationWorkRegistry() : applicationWorkRegistry;
    registriesByDoor.set(liveDoor, scopedRegistry);
  }
  const workRegistry = registryOverride ?? scopedRegistry;
  return {
    mount<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, Render>(
      admitted: AdmittedRoute<G, S, E, Render>,
      address: AdmittedAddressPort,
      memory: () => unknown = () => ({}),
    ) {
      const route: AdmittedRoute = admitted;
      const registry = createAdmittedRouteRegistry();
      const registration = registry.register(route);
      const resolve = () => {
        const bindings = resolveRouteBindings(registry, route);
        if (!bindings) throw Error("Foreign or retired mount admission");
        return bindings;
      };
      const bindings = resolve();
      for (const body of Object.values(bindings.bodies)) {
        if (!admittedMountBodyKinds.includes(body.kind)) {
          registration.deactivate();
          throw Error(`Unsupported admitted mount body slot: ${body.slot}`);
        }
      }
      // Migration bodies execute only in host admission. The Work feed proves registration
      // and finishes persistent migration before exposing Work; no body or schema is sent here.
      // Result landing owns presentation for verbs without a sealed ModelWrite preview.
      for (const [id, verb] of Object.entries(route.data.verbs)) {
        if (
          verb.present &&
          (verb.kind !== "command" || bindings.entries[verb.entry]?.axes.effect !== "ModelWrite")
        ) {
          registration.deactivate();
          throw Error(
            `Unsupported admitted presentation phase: verbs.${id}.present requires a sealed preview`,
          );
        }
      }
      const observers = createAdmittedObservers(route.data, bindings.bodies);
      const cells = createAdmittedCells(
        route.data,
        bindings.schemas,
        bindings.bodies,
        route.resolvedWork?.schema,
      );
      let readings: Record<string, ReadingSnapshot<unknown>> = {};
      const policy = createPagePolicy(
        route.data,
        bindings.schemas,
        () => "unresolved",
        route.data.transition
          ? (current, patch, origin) => {
              const deps = route.data.transitionDeps ?? { page: [], work: [], readings: [] };
              if (deps.readings.some((id) => !readings[id]?.current))
                return { ok: false, reason: "Transition reading evidence unavailable or stale" };
              const acceptedWork = owner.read()?.work?.value as Record<string, unknown> | undefined;
              if (deps.work.length && !acceptedWork)
                return { ok: false, reason: "Transition Work unavailable" };
              const evidence = Object.fromEntries(deps.readings.map((id) => [id, readings[id]]));
              const result = resolve().bodies[route.data.transition!]!.run(
                current,
                patch,
                origin,
                freezePage({
                  page: Object.fromEntries(deps.page.map((key) => [key, current[key]])),
                  work: Object.fromEntries(deps.work.map((key) => [key, acceptedWork?.[key]])),
                  readings: evidence,
                }),
              ) as import("../../../../packages/agent-contracts/src/route-kernel-page").DecodeResult<unknown>;
              // Re-entrant publication cannot decide on the evidence captured above.
              if (
                deps.readings.some((id) => readings[id] !== evidence[id] || !readings[id]?.current)
              )
                return { ok: false, reason: "Transition reading evidence changed" };
              return result;
            }
          : undefined,
      );

      const initial = policy.initial();
      if (!initial.ok) {
        registration.deactivate();
        throw Error(initial.reason);
      }
      const target = services.target?.() ?? null;
      const identityForPage = (page: Readonly<Record<string, unknown>>) => ({
        target,
        work: route.data.work
          ? bindWork(
              route.data.work.route,
              null,
              routeWorkSubject(route.data, bindings, page) ??
                address.read().get("work") ??
                undefined,
              target?.kind === "document" ? target.ref : undefined,
            )
          : null,
      });
      const registryForWork =
        fixtureName(Object.fromEntries(address.read())) === null
          ? workRegistry
          : createApplicationWorkRegistry();
      const leases = new Map<
        string,
        ReturnType<typeof registryForWork.acquire> & { released?: boolean }
      >();
      const entryFor = (key: import("@pe/agent-contracts").WorkKey) => {
        const id = workKey(key);
        let lease = leases.get(id);
        const current = owner.read()?.scope.identity.work;
        const shown = current && workKey(current) === id;
        if (shown && !closed) {
          for (const [other, held] of leases)
            if (other !== id && !held.released) {
              held.released = true;
              held.release();
            }
        }
        if (!lease || (lease.released && shown && !closed)) {
          lease = registryForWork.acquire(key);
          leases.set(id, lease);
          const unsubscribe = lease.entry.subscribe(() => {
            observeReceipts();
            notify();
          });
          const release = lease.release.bind(lease);
          lease.release = () => {
            unsubscribe();
            release();
          };
        }
        return lease.entry;
      };
      const mountJournal = (key: import("@pe/agent-contracts").WorkKey) => entryFor(key).journal;
      const workSpec = route.data.work
        ? {
            route: route.data.work.route,
            title: route.data.name,
            description: "",
            schema: route.resolvedWork!.schema,
          }
        : undefined;
      const issuer = createRouteTokenIssuer();
      const ownerOptions = {
        dependencies: () =>
          Object.fromEntries(
            Object.entries(readings)
              .filter(([, value]) => value.current)
              .map(([id, value]) => [id, value.current ? value.hash : ""]),
          ),
        scopeFields: [
          route.data.subject.field,
          ...(route.data.workSubject ? [route.data.workSubject] : []),
        ],
        identityForPage,
        preparePage: policy.prepare,
        issuer,
      };
      const owner = createRouteScopeGate(
        workSpec
          ? {
              ...ownerOptions,
              workSchema: workSpec.schema,
              hashWork: canonicalEnvironmentInput,
              journal: mountJournal,
            }
          : ownerOptions,
      );
      owner.enter(identityForPage(initial.value), initial.value);
      const ports = createPagePorts(route.data, { ...owner, readPage: () => owner.read()!.page });
      const environmentIssuer = createRouteEnvironmentIssuer();
      const generations = new Map<string, number>();
      const plan = createAdmittedReadingPlan({
        route,
        issuer: environmentIssuer,
        key: (id) => ({
          processIncarnation: "application",
          documentLifetime: "none",
          freshnessGeneration: generations.get(id) ?? 0,
        }),
      });
      let closed = false;
      let visible = true;
      let writable = true;
      const listeners = new Set<() => void>();
      let revision = 0;
      const notify = () => {
        if (!closed) {
          revision++;
          listeners.forEach((listener) => listener());
        }
      };
      const validate: EnvironmentValidation = {
        admitted: (candidate) => candidate === route && registry.resolve(route) === route,
        token: (token) => owner.current(token),
        scope: (scope) => owner.current(scope),
        invocation: (invocation) => owner.current(invocation),
        key: (key) =>
          Array.from(active.values()).some((read) => read.handle?.key === key || read.key === key),
        detail: () => false,
        geometryScope: () => false,
      };
      type Active = {
        signature: string;
        key: import("../../../../packages/agent-contracts/src/route-kernel-environment").ResolvedReadKey;
        token: ReturnType<typeof owner.capture>;
        snapshot: ReadingSnapshot<unknown>;
        handle?: ReadHandle<unknown>;
        unsubscribe?: () => void;
      };
      const active = new Map<string, Active>();
      const retained = new Map<string, { signature: string; snapshot: ReadingSnapshot<unknown> }>();
      const previous = new Map<string, unknown>();
      const dependencies = new Map<string, readonly import("@pe/agent-contracts").Effect[]>();
      const hostGenerations = new Map<string, string | null>();
      const seenReceipts = new Map<string, string>();
      const paneDemand = new Map<string, boolean>();
      const evidence = sourceReadingEvidence(services);
      const invalidate = (id: string) => {
        generations.set(id, (generations.get(id) ?? 0) + 1);
        retire(id);
        retained.delete(id);
        geometry.invalidate(id);
        const stale = new Set([id]);
        for (let changed = true; changed; ) {
          changed = false;
          for (const [key, reading] of Object.entries(route.data.readings))
            if (!stale.has(key) && reading.deps.readings.some((dep) => stale.has(dep))) {
              stale.add(key);
              changed = true;
            }
        }
        readings = Object.freeze({
          ...readings,
          ...Object.fromEntries(
            [...stale].map((key) => [
              key,
              {
                status: "unavailable" as const,
                current: false as const,
                value: previous.get(key),
                reason: "Host evidence changed",
              },
            ]),
          ),
        });
      };
      function observeReceipts() {
        const key = owner.read()?.scope.identity.work;
        if (!key) return;
        const receipts = entryFor(key).activity();
        const ids = new Set(receipts.map((receipt) => receipt.id));
        for (const id of seenReceipts.keys()) if (!ids.has(id)) seenReceipts.delete(id);
        for (const receipt of receipts) {
          const stamp = canonicalEnvironmentInput([receipt.state, receipt.effects]);
          if (seenReceipts.get(receipt.id) === stamp) continue;
          seenReceipts.set(receipt.id, stamp);
          for (const [id, effects] of dependencies)
            if (receiptHitsReading(receipt, effects)) invalidate(id);
        }
        schedule();
      }
      const wantedReadings = () => {
        const roots = new Set<string>(route.data.observe);
        for (const [id, pane] of Object.entries(route.data.panes))
          if (visible && paneDemand.get(id) !== false && observers.visible(id))
            pane.draws.forEach((reading) => roots.add(reading));
        // Picker/observers and active invocations are consumers too.
        for (const field of Object.values(route.data.fields))
          if (
            field.role === "subject" &&
            visible &&
            paneDemand.get(route.data.subject.pane) !== false &&
            observers.visible(route.data.subject.pane)
          )
            roots.add(field.picker.reading);
        for (const id of queryInputs.keys()) roots.add(id);
        return readingClosure(route, roots);
      };
      const environment = (() => {
        try {
          return selectRouteEnvironment({
            search: Object.fromEntries(address.read()),
            live: () =>
              createRouteEnvironment({
                issuer: environmentIssuer,
                validate,
                ports: {
                  ...services,
                  work: route.data.work ? { read: liveDoor, submit: liveDoor } : undefined,
                  submitNative: (command) =>
                    services.submitNative
                      ? services.submitNative(command)
                      : (services.nativeWrite ?? liveDoor).submit(command),
                  geometry: undefined,
                },
              }),
            fixture: (name) =>
              createNamedFixtureRouteEnvironment({
                issuer: environmentIssuer,
                validate,
                plan,
                name,
                workSpec,
                now: () => services.clock.now(),
              }),
          });
        } catch (error) {
          owner.close();
          plan.close();
          registration.deactivate();
          throw error;
        }
      })();
      const fixture = fixtureName(Object.fromEntries(address.read()));
      const door =
        fixture === null
          ? liveDoor
          : route.data.work
            ? { ...environment.environment.work.read, ...environment.environment.work.submit }
            : undefined;
      const work = createAdmittedWork(
        route,
        owner,
        door,
        () => schedule(),
        (key, state) => {
          entryFor(key).restore(state);
        },
        (scope) => entryFor(scope.key).connect(scope, door!),
        (key) => entryFor(key).refusedEdits,
      );
      let savedRecovery: { from: string; value: unknown } | null = null;
      let recoverySentence: string | null = null;
      let recoveryProblem: string | null = null;
      let recoveryBusy = false;
      let recoveryScope: unknown;
      let recoveryRevision: number | null = null;
      function syncRecovery() {
        const snapshot = owner.read();
        if (snapshot?.scope !== recoveryScope) {
          recoveryScope = snapshot?.scope;
          recoveryRevision = null;
          savedRecovery = null;
          recoverySentence = null;
          recoveryProblem = null;
          recoveryBusy = false;
        }
        if (
          fixture !== null ||
          !route.data.salvage ||
          !work.ready() ||
          !snapshot?.work ||
          snapshot.work.revision === recoveryRevision
        )
          return;
        recoveryRevision = snapshot.work.revision;
        const scope = snapshot.scope;
        const revision = recoveryRevision;
        void salvageRouteWork(scope.identity.work!).then(
          (saved) => {
            if (closed || owner.read()?.scope !== scope || recoveryRevision !== revision) return;
            savedRecovery = saved;
            notify();
          },
          (error: unknown) => {
            if (closed || owner.read()?.scope !== scope || recoveryRevision !== revision) return;
            recoveryProblem = String(error);
            notify();
          },
        );
      }
      const geometry = createAdmittedGeometry({
        route,
        owner,
        issuer: environmentIssuer,
        entries: bindings.entries,
        door: fixture === null ? services.geometry : fixtureGeometryDoor(plan.seed(fixture)),
        notify: () => schedule(),
      });
      const retire = (id: string) => {
        const read = active.get(id);
        if (!read) return;
        owner.retire(read.token);
        active.delete(id);
        if (read.snapshot.current)
          retained.set(id, { signature: read.signature, snapshot: read.snapshot });
        read.unsubscribe?.();
        read.handle?.release();
      };
      const watchEvidence = (
        readingId: string,
        request: import("../../../../packages/agent-contracts/src/route-kernel-environment").ResolvedRead<unknown>,
        record: Active,
      ) => {
        return fixture === null
          ? evidence?.observe(request, record.token, (event) => {
              if (closed || active.get(readingId) !== record) return;
              if (event.kind === "log") {
                const key = owner.read()?.scope.identity.work;
                if (key) {
                  const entry = entryFor(key);
                  const rows = sourceTimeline.get(entry) ?? [];
                  rows.push(
                    freezePage({
                      kind: "feed",
                      at: services.clock.now(),
                      subject: readingId,
                      basis: event.value,
                    }),
                  );
                  if (rows.length > 200) rows.shift();
                  sourceTimeline.set(entry, rows);
                }
                notify();
              } else {
                const had = hostGenerations.has(readingId);
                const prior = hostGenerations.get(readingId);
                hostGenerations.set(readingId, event.value);
                if (had && prior !== event.value) {
                  invalidate(readingId);
                  schedule();
                }
              }
            })
          : undefined;
      };
      const pickerOptions: Record<string, unknown> = {};
      const demanded = new Set<string>();
      // Invocation arguments belong to the attempt, never to Page or selection.
      const queryInputs = new Map<
        string,
        {
          input: unknown;
          landing?: string;
          landed?: boolean;
          inputsCurrent?: () => boolean;
          invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
        }
      >();
      const queryLandings = new Map<string, CommandResultDecode>();
      const subjectField = route.data.subject.field;
      let evidenceScope = owner.read()!.scope;
      let drawing = false;
      let scheduling = false;
      let again = false;
      const schedule = () => {
        if (drawing) throw Error("Admitted observers cannot run during render");
        if (closed || !visible) return;
        if (scheduling) {
          again = true;
          return;
        }
        scheduling = true;
        try {
          do {
            again = false;
            resolve();
            work.sync();
            syncRecovery();
            if (evidenceScope !== owner.read()!.scope) {
              evidenceScope = owner.read()!.scope;
              for (const [id, reading] of Object.entries(route.data.readings))
                if (reading.retain.evidence === "scope") {
                  retire(id);
                  retained.delete(id);
                  previous.delete(id);
                }
            }
            geometry.syncSubject();
            for (const [id, query] of queryInputs) {
              // Read currency follows declared arguments; previews keep their exact basis.
              if (
                query.inputsCurrent
                  ? owner.current(query.invocation.token) && query.inputsCurrent()
                  : owner.current(query.invocation)
              )
                continue;
              queryInputs.delete(id);
              demanded.delete(id);
              retire(id);
              geometry.cancel(id);
            }
            const used = new Set<string>();
            observers.update({
              page: owner.read()!.page,
              work: owner.read()!.work?.value ?? null,
              readings,
            });
            const wanted = wantedReadings();
            const cache = new Map<string, ReadingSnapshot<unknown>>();
            const next: typeof readings = {};
            for (const id of Object.keys(route.data.readings)) {
              const declaration = route.data.readings[id]!;
              if (
                (declaration.demand === "explicit" &&
                  !(declaration.kind === "use" && declaration.geometry) &&
                  !demanded.has(id)) ||
                (declaration.demand === "subject" && owner.read()!.page[subjectField] === null)
              ) {
                next[id] = {
                  status: "unavailable",
                  current: false,
                  reason: "Explicit demand required",
                };
                continue;
              }
              if (!wanted.has(id)) {
                next[id] = readings[id] ?? {
                  status: "unavailable",
                  current: false,
                  reason: "Pane hidden",
                };
                geometry.suspend(id);
                continue;
              }
              if (declaration.kind === "use" && declaration.geometry)
                dependencies.set(
                  id,
                  target?.kind === "document" ? [{ kind: "document", ref: target.ref }] : [],
                );
              next[id] = plan.read(
                id,
                {
                  page: owner.read()!.page,
                  work: (owner.read()!.work?.value ?? null) as Readonly<
                    Record<string, unknown>
                  > | null,
                },
                (request) => {
                  const readingId = plan.readingId(request)!;
                  if (
                    route.data.readings[readingId]!.demand === "explicit" &&
                    !demanded.has(readingId)
                  )
                    return {
                      status: "unavailable",
                      current: false,
                      reason: "Explicit demand required",
                    };
                  used.add(readingId);
                  const signature = canonicalEnvironmentInput(request.key);
                  dependencies.set(
                    readingId,
                    evidence?.dependencies(request, owner.capture(`dependencies:${readingId}`)) ??
                      (target?.kind === "document" ? [{ kind: "document", ref: target.ref }] : []),
                  );
                  const saved = retained.get(readingId);
                  if (saved?.signature === signature && !active.has(readingId)) {
                    const record: Active = {
                      signature,
                      key: request.key,
                      token: owner.capture(readingId),
                      snapshot: saved.snapshot,
                    };
                    active.set(readingId, record);
                    record.unsubscribe = watchEvidence(readingId, request, record);
                    return saved.snapshot;
                  }
                  let read = active.get(readingId);
                  if (read?.signature !== signature) {
                    retire(readingId);
                    read = undefined;
                  }
                  if (!read) {
                    const record: Active = {
                      signature,
                      key: request.key,
                      token: owner.capture(readingId),
                      snapshot: {
                        status: "pending",
                        current: false,
                        value: previous.get(readingId),
                        reason: "Reading pending",
                      },
                    };
                    active.set(readingId, record);
                    record.handle = environment.environment.reads.acquire(request, record.token);
                    const accept = (snapshot: ReadingSnapshot<unknown>) => {
                      if (
                        closed ||
                        active.get(readingId) !== record ||
                        !owner.current(record.token)
                      )
                        return;
                      if (!snapshot.current) {
                        record.snapshot = freezePage({
                          ...snapshot,
                          value: snapshot.value ?? previous.get(readingId),
                        });
                        return;
                      }
                      const parsed = request.output.safeParse(snapshot.value);
                      if (!parsed.success) {
                        const query = queryInputs.get(readingId);
                        if (query?.landing)
                          queryLandings.set(readingId, {
                            kind: "result-undecodable",
                            key: request.key.op,
                            receiptId: query.invocation.id,
                            problem: parsed.error.message,
                          });
                      }
                      if (parsed.success) previous.set(readingId, freezePage(parsed.data));
                      record.snapshot = parsed.success
                        ? freezePage({ ...snapshot, value: parsed.data })
                        : { status: "failed", current: false, reason: parsed.error.message };
                    };
                    accept(record.handle.read());
                    const stopEvidence = watchEvidence(readingId, request, record);
                    const stopReading = environment.environment.readings.subscribe(
                      request,
                      record.token,
                      (snapshot) => {
                        accept(snapshot);
                        schedule();
                      },
                    );
                    record.unsubscribe = () => {
                      stopEvidence?.();
                      stopReading();
                    };
                    read = record;
                  }
                  return read.snapshot;
                },
                geometry.read,
                (key) => queryInputs.get(key),
                cache,
              );
            }
            for (const id of active.keys()) if (!used.has(id)) retire(id);
            for (const [id, snapshot] of Object.entries(next)) {
              if (snapshot.current) previous.set(id, snapshot.value);
              else if (snapshot.value === undefined && previous.has(id))
                next[id] = { ...snapshot, value: previous.get(id) };
            }
            readings = Object.freeze(
              Object.fromEntries(
                Object.entries(next).map(([id, snapshot]) => [id, Object.freeze(snapshot)]),
              ),
            );
            // Derived dependencies can change during this pass. Retire their dependent
            // query before publishing or landing a result against the previous inputs.
            if (
              Array.from(queryInputs.values()).some(
                (query) => query.inputsCurrent && !query.inputsCurrent(),
              )
            ) {
              again = true;
              continue;
            }
            cells.update((owner.read()!.work?.value ?? null) as Record<string, unknown> | null);
            observers.update({
              page: owner.read()!.page,
              work: owner.read()!.work?.value ?? null,
              readings,
            });
            const afterDemand = wantedReadings();
            if ([...afterDemand].some((id) => !wanted.has(id))) again = true;
            for (const [readingId, query] of queryInputs) {
              const result = readings[readingId];
              if (
                !query.landing ||
                query.landed ||
                !result?.current ||
                result.status !== "ready" ||
                !owner.current(query.invocation.token)
              )
                continue;
              const declaration = route.data.readings[readingId]!;
              if (declaration.kind === "derive") continue;
              const value =
                declaration.kind === "use" && declaration.geometry
                  ? (result.value as { kind: string; value?: unknown }).value
                  : result.value;
              const decoded = bindings.entries[declaration.entry]!.output.safeParse(value);
              query.landed = true;
              if (!decoded.success) {
                queryLandings.set(readingId, {
                  kind: "result-undecodable",
                  key: declaration.entry,
                  receiptId: query.invocation.id,
                  problem: decoded.error.message,
                });
                continue;
              }
              queryLandings.set(readingId, { kind: "decoded", value: decoded.data });
              // A current read publishes Page against the accepted state at completion.
              // Its original Work revision remains unchanged for query patch writes.
              const landing = owner.invocation(query.invocation.token, {});
              if (!landing.ok) continue;
              const patch = bindings.bodies[query.landing]!.run(
                freezePage(decoded.data),
                owner.read()!.page,
              );
              owner.acceptPage(landing.value, patch as Parameters<typeof owner.acceptPage>[1]);
            }
            for (const [key, field] of Object.entries(route.data.fields)) {
              if (field.role === "subject")
                pickerOptions[key] = freezePage(
                  bindings.bodies[field.picker.options]!.run(readings[field.picker.reading]),
                );
            }
            for (const [id, pending] of preparing) {
              if (!owner.current(pending.invocation)) {
                preparing.delete(id);
                reviewRefusals.set(id, new ReviewRefusal("review-stale"));
                continue;
              }
              const result = readings[pending.reading];
              if (!result?.current) continue;
              preparing.delete(id);
              const sealed = writePreviewSchema.parse(result.value);
              const handle = workHandleSchema.parse(
                (sealed.seal.work as { handle?: unknown })?.handle,
              );
              if (canonicalEnvironmentInput(handle) !== pending.handle)
                throw Error("Preview sealed a different Work handle");
              const presentation = present(id, sealed, pending.evidence);
              if (!owner.current(pending.invocation)) {
                reviewRefusals.set(id, new ReviewRefusal("review-stale"));
                continue;
              }
              reviews.set(id, {
                presentation,
                invocation: pending.invocation,
                preview: result.value,
                send: () => pending.send(),
              });
            }
          } while (again && !closed);
        } finally {
          scheduling = false;
        }
        notify();
      };
      const preparing = new Map<
        string,
        {
          invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
          reading: string;
          handle: string;
          evidence: PresentationEvidence;
          send(): unknown;
        }
      >();
      const reviews = new Map<
        string,
        {
          invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
          send(): unknown;
          preview: unknown;
          presentation?: { sentence: string; rows: readonly string[] };
        }
      >();
      const reviewRefusals = new Map<string, ReviewRefusal>();
      let presenting = false;
      const present = (
        id: string,
        result: unknown,
        evidence: PresentationEvidence,
        body = route.data.verbs[id]?.present,
      ) => {
        if (!body) return undefined;
        let value: unknown;
        presenting = true;
        try {
          value = bindings.bodies[body]!.run(freezePage(result), evidence);
        } catch {
          const refusal = new ReviewRefusal("present-threw");
          reviewRefusals.set(id, refusal);
          throw refusal;
        } finally {
          presenting = false;
        }
        const parsed = z
          .union([z.string(), z.strictObject({ sentence: z.string(), rows: z.array(z.string()) })])
          .safeParse(value);
        if (!parsed.success) {
          const refusal = new ReviewRefusal("present-invalid");
          reviewRefusals.set(id, refusal);
          throw refusal;
        }
        return freezePage(
          typeof parsed.data === "string" ? { sentence: parsed.data, rows: [] } : parsed.data,
        );
      };
      const project = (keys: readonly string[], value: Readonly<Record<string, unknown>>) =>
        freezePage(Object.fromEntries(keys.map((key) => [key, value[key]])));
      const action = () => {
        if (drawing) throw Error("Admitted action cannot run during render");
        if (presenting) throw Error("Admitted action cannot run during presentation");
        if (closed) throw Error("Mount closed");
        if (!visible || !writable) throw Error("Place is not writable");
      };
      const place = (
        pane: string,
        row: unknown,
        input: unknown,
        basis?: InvocationToken | null,
      ) => {
        action();
        resolve();
        const declaration = route.data.panes[pane];
        if (!declaration) throw Error(`Unknown pane: ${pane}`);
        return placeAdmittedVerbs(
          declaration,
          bindings.schemas,
          bindings.bodies,
          row,
          input,
          (id, input) => invoke(id, input, basis ?? undefined),
        );
      };
      const editBases = new WeakMap<InvocationToken, NonNullable<ReturnType<typeof owner.read>>>();
      let renderedBasis: InvocationToken | null = null;
      const workBasis = () => {
        const snapshot = owner.read();
        if (!snapshot?.work || !work.ready()) return null;
        if (renderedBasis && editBases.get(renderedBasis) === snapshot) return renderedBasis;
        const issued = owner.invocation(owner.capture(`rendered-work:${crypto.randomUUID()}`), {});
        if (!issued.ok) throw Error(issued.reason);
        renderedBasis = issued.value;
        editBases.set(renderedBasis, snapshot);
        return renderedBasis;
      };
      const landings = new Map<string, CommandResultDecode>();
      const nativeAttempts = new Map<
        string,
        { input: unknown; basis: InvocationToken; retry: () => unknown }
      >();
      const invoke = (id: string, input: unknown, basis?: InvocationToken) => {
        action();
        resolve();
        reviewRefusals.delete(id);
        const declaration = route.data.verbs[id];
        if (!declaration) throw Error(`Unknown verb: ${id}`);
        const parsed = bindings.schemas[declaration.input]!.parse(input);
        const edit = basis === undefined ? undefined : editBases.get(basis);
        if (basis !== undefined && (!edit || edit.scope !== owner.read()?.scope))
          throw Error("Stale or foreign accepted Work basis");
        if (declaration.deps.work.length && (!work.ready() || !owner.read()!.work))
          throw Error("Work unavailable");
        const dependencies: Record<string, string> = {};
        for (const key of declaration.deps.readings) {
          const reading = readings[key];
          if (!reading?.current) throw Error(`Reading unavailable: ${key}`);
          dependencies[key] = reading.hash;
        }
        const issued = owner.invocation(owner.capture(`verb:${id}`), dependencies);
        if (!issued.ok) throw Error(issued.reason);
        const invocation = issued.value;
        const context = () => ({
          workBasis: basis ?? (owner.read()?.work ? invocation : null),
          page: project(declaration.deps.page, owner.read()!.page),
          work: project(
            declaration.deps.work,
            ((edit?.work ?? owner.read()!.work)?.value as Record<string, unknown>) ?? {},
          ),
          readings: freezePage(
            Object.fromEntries(declaration.deps.readings.map((key) => [key, readings[key]])),
          ),
          captures: freezePage(
            Object.fromEntries(declaration.captures.map((key) => [key, readings[key]])),
          ),
        });
        if (declaration.ready) {
          const ready = bindings.bodies[declaration.ready]!.run(context(), parsed);
          if (ready !== true) throw Error(String(ready));
        }
        let preview: unknown;
        let send: () => unknown;
        if (declaration.kind === "work") {
          let label = declaration.label;
          if (declaration.describe) {
            const evidence = context();
            let described: unknown;
            try {
              described = bindings.bodies[declaration.describe]!.run(
                freezePage(parsed),
                freezePage({
                  page: evidence.page,
                  work: evidence.work,
                  readings: evidence.readings,
                }),
              );
            } catch {
              return { kind: "refused", reason: "describe-threw" } as const;
            }
            if (typeof described !== "string")
              return { kind: "refused", reason: "describe-not-string" } as const;
            label = described;
          }
          const patches = () =>
            admittedWorkPatches(
              route.data,
              bindings.schemas,
              bindings.bodies[declaration.patches]!.run(context(), parsed),
              route.resolvedWork!.schema,
            );
          preview = freezePage(patches());
          send = () => {
            const observation = work.write(
              () => preview as import("@pe/agent-contracts").WorkWrite["patches"],
              invocation,
              invocation.id,
              label,
              basis,
            );
            observation.subscribe(
              (outcome) => {
                if (outcome.kind === "accepted") {
                  const key = outcome.ack.key;
                  mountJournal(key).describe(outcome.ack.press ?? invocation.id, {
                    label,
                  });
                }
                if (owner.read()?.scope === invocation.token.scope) notify();
              },
              () => {},
            );
            return observation;
          };
        } else if (declaration.kind === "command") {
          const entry = bindings.entries[declaration.entry]!;
          const modelWrite = entry.axes.effect === "ModelWrite";
          const captured = context();
          // Display evidence labels only. owner.current enforces freshness; the host seal binds the write.
          const evidence = freezePage(
            structuredClone({
              page: captured.page,
              work: captured.work,
              readings: captured.readings,
            }),
          );
          const accepted = owner.read()!;
          if (modelWrite && basis && basis.workRevision !== accepted.work?.revision)
            throw Error("Stale accepted Work basis; prepare from the current revision");
          if (modelWrite && (!work.ready() || !accepted.work || !accepted.scope.identity.work))
            throw Error("Accepted Work unavailable");
          // ModelWrite has one input authority: B's accepted key and revision, never draft intent.
          const declaredIntent = bindings.bodies[declaration.intent]!.run(
            context(),
            parsed,
          ) as Record<string, unknown>;
          if (modelWrite && Object.hasOwn(declaredIntent, "work"))
            throw Error("ModelWrite intent cannot supply Work identity");
          const intent: Record<string, unknown> = freezePage(
            entry.input.parse(
              modelWrite
                ? {
                    ...declaredIntent,
                    work: workHandleSchema.parse({
                      key: accepted.scope.identity.work,
                      revision: accepted.work!.revision,
                    }),
                  }
                : declaredIntent,
            ) as Record<string, unknown>,
          );
          entry.input.parse(intent);
          preview = freezePage({ work: accepted.work, input: intent });
          // ActionJournal owns the existing Reject? consent window after this admission.
          let commandId = invocation.id;
          send = () => {
            if (!door) throw Error("Native commands unavailable");
            const submission = (
              fixture === null
                ? (command: Parameters<NonNullable<KernelServices["submitNative"]>>[0]) =>
                    services.submitNative
                      ? services.submitNative(command)
                      : (services.nativeWrite ?? door).submit(command)
                : (command: Parameters<NonNullable<KernelServices["submitNative"]>>[0]) =>
                    door.submit(command)
            )({
              id: commandId,
              key: declaration.entry,
              target: target ?? { kind: "host" },
              input: intent,
            });
            nativeAttempts.set(submission.handle.id, {
              input: freezePage(intent),
              basis: invocation,
              retry: () => {
                const next = owner.invocation(
                  owner.capture("command-retry"),
                  invocation.dependencies,
                );
                if (!next.ok) throw Error(next.reason);
                commandId = next.value.id;
                return send();
              },
            });
            if (declaration.lands) {
              const decode = commandResultDecoder(submission, bindings.entries);
              const land = bindings.bodies[declaration.lands]!.run;
              submission.accepted.subscribe(
                (outcome) => {
                  if (outcome.kind === "pending") return;
                  const result = decode(outcome);
                  landings.set(submission.handle.id, result);
                  if (result.kind === "decoded" && owner.current(invocation)) {
                    const patch = land(freezePage(result.value), owner.read()!.page);
                    owner.acceptPage(invocation, patch as Parameters<typeof owner.acceptPage>[1]);
                  }
                  notify();
                },
                () => {},
              );
            }
            return submission;
          };
          if (modelWrite) {
            const command = Object.hasOwn(commands, declaration.entry)
              ? commands[declaration.entry as SemanticActionKey]
              : undefined;
            const previewKey =
              command && "writeBoundary" in command
                ? command.writeBoundary.previewKey
                : `${declaration.entry}.preview`;
            const previewEntry = bindings.entries[previewKey];
            if (
              !previewEntry ||
              previewEntry.axes.effect !== "TransactRead" ||
              !previewEntry.axes.rollsBack
            )
              throw Error("ModelWrite requires its rolled-back catalog preview");
            const candidates = Object.entries(route.data.readings).filter(
              ([, reading]) =>
                reading.kind === "use" &&
                reading.entry === previewKey &&
                reading.demand === "explicit",
            );
            if (candidates.length !== 1)
              throw Error("ModelWrite preview must identify exactly one explicit reading");
            previewEntry.input.parse(intent);
            const readingId = candidates[0]![0];
            reviews.delete(id);
            preparing.set(id, {
              evidence,
              invocation,
              reading: readingId,
              handle: canonicalEnvironmentInput(intent.work),
              send: () => {
                if (!work.ready() || !owner.current(invocation))
                  throw new ReviewRefusal("review-stale");
                return send();
              },
            });
            const previous = queryInputs.get(readingId);
            if (previous) owner.retire(previous.invocation.token);
            queryInputs.set(readingId, { input: intent, invocation });
            demanded.add(readingId);
            generations.set(readingId, (generations.get(readingId) ?? 0) + 1);
            retire(readingId);
            schedule();
            const review = reviews.get(id);
            return review ? { kind: "review", preview: review.preview } : { kind: "preview" };
          }
        } else if (declaration.kind === "page") {
          const patch = bindings.bodies[declaration.patch]!.run(context(), parsed);
          preview = patch;
          send = () =>
            owner.acceptPage(invocation, patch as Parameters<typeof owner.acceptPage>[1]);
        } else {
          const entry = bindings.entries[declaration.entry]!;
          const args = freezePage(
            structuredClone(
              entry.input.parse(bindings.bodies[declaration.args]!.run(context(), parsed)),
            ),
          );
          const targets = Object.entries(route.data.readings).filter(
            ([id, reading]) =>
              reading.kind !== "derive" &&
              reading.entry === declaration.entry &&
              (declaration.reading === undefined || declaration.reading === id),
          );
          if (targets.length !== 1)
            throw Error("Query entry must identify exactly one declared reading");
          const [readingId, reading] = targets[0]!;
          preview = args;
          send = () => {
            const previous = queryInputs.get(readingId);
            if (previous) owner.retire(previous.invocation.token);
            queryLandings.delete(readingId);
            queryInputs.set(readingId, {
              input: args,
              invocation,
              landing: declaration.lands,
              inputsCurrent: () => {
                try {
                  // workBasis stays at the read's starting revision, including expectedRevision.
                  const current = entry.input.parse(
                    bindings.bodies[declaration.args]!.run(
                      {
                        ...context(),
                        work: project(
                          declaration.deps.work,
                          (owner.read()!.work?.value as Record<string, unknown>) ?? {},
                        ),
                      },
                      parsed,
                    ),
                  );
                  return canonicalEnvironmentInput(current) === canonicalEnvironmentInput(args);
                } catch {
                  return false;
                }
              },
            });
            demanded.add(readingId);
            generations.set(readingId, (generations.get(readingId) ?? 0) + 1);
            retire(readingId);
            if (reading.kind === "use" && reading.geometry) geometry.refresh(readingId);
            else schedule();
          };
        }
        const dispatch = () => {
          if (!owner.current(invocation)) throw new ReviewRefusal("review-stale");
          return send();
        };
        if (declaration.review === "shown") {
          reviews.set(id, { invocation, preview, send: dispatch });
          notify();
          return { kind: "review", preview };
        }
        return dispatch();
      };
      const journal = () => {
        const key = owner.read()?.scope.identity.work;
        return key ? mountJournal(key) : null;
      };
      let journalProblem: {
        message: string;
        journal: ReturnType<typeof createWorkJournal>;
        revision: number | null;
      } | null = null;
      const historyProblem = (
        current: ReturnType<typeof createWorkJournal>,
        message: string | null,
      ) => {
        journalProblem = message
          ? { message, journal: current, revision: current.read().revision }
          : null;
      };
      const restore = async (direction: "undo" | "redo", press?: string) => {
        action();
        resolve();
        const current = journal();
        if (closed || !work.ready() || !current) throw Error("Work unavailable");
        const basis = owner.invocation(owner.capture(`history:${direction}`), {});
        if (!basis.ok) throw Error(basis.reason);
        const result = await current[direction](
          (request) => work.submit(request, basis.value),
          press,
        );
        historyProblem(current, result.ok ? null : result.message);
        notify();
        return result;
      };
      const revert = async (press?: string) => {
        resolve();
        const current = journal();
        if (closed || !work.ready() || !current) throw Error("Work unavailable");
        const state = current.read();
        const step = state.undo.at(-1);
        if (!step || (press !== undefined && step.press !== press))
          throw Error("The selected history entry is no longer last");
        if (state.busy || step.barrier || step.superseded)
          throw Error(step.superseded?.message ?? "History step is blocked");
        const basis = owner.invocation(owner.capture("history:revert"), {});
        if (!basis.ok) throw Error(basis.reason);
        // An ordinary appended edit of the host's inverse makes Revert itself undoable.
        const result = await work.submit(
          {
            kind: "apply",
            expectedRevision: owner.read()!.work!.revision,
            press: basis.value.id,
            label: `Revert ${step.label}`,
            patches: step.transitions
              .slice(0, step.cursor)
              .reverse()
              .flatMap((t) => t.inverse),
          },
          basis.value,
        );
        if (result.ok) current.describe(basis.value.id, { label: `Revert ${step.label}` });
        historyProblem(
          current,
          result.ok ? null : "agentHint" in result ? result.agentHint : result.error,
        );
        notify();
        return result;
      };
      const history = route.data.work
        ? {
            undo: (press?: string) => restore("undo", press),
            redo: (press?: string) => restore("redo", press),
            revert,
          }
        : undefined;
      const prepareSalvage = async () => {
        action();
        resolve();
        const key = owner.read()?.scope.identity.work;
        if (!route.data.salvage || !key || !work.ready() || fixture !== null)
          throw Error("Salvage unavailable");
        const issued = owner.invocation(
          owner.capture("work-salvage"),
          Object.fromEntries(
            Object.entries(readings)
              .filter(([, reading]) => reading.current)
              .map(([id, reading]) => [id, (reading as { hash: string }).hash]),
          ),
        );
        if (!issued.ok) throw Error(issued.reason);
        const deps = route.data.salvageDeps ?? { page: [], work: [], readings: [] };
        for (const id of deps.readings)
          if (!readings[id]?.current) throw Error(`Reading unavailable: ${id}`);
        // Display evidence only: the invocation owns freshness, never a second write seal.
        const evidence = freezePage(
          structuredClone({
            page: project(deps.page, owner.read()!.page),
            work: project(deps.work, owner.read()!.work!.value as Record<string, unknown>),
            readings: Object.fromEntries(deps.readings.map((id) => [id, readings[id]])),
          }),
        );
        const saved = await salvageRouteWork(key);
        if (!owner.current(issued.value) || !work.ready()) throw Error("Salvage is stale");
        if (!saved) return null;
        const decoded = z
          .discriminatedUnion("ok", [
            z.strictObject({ ok: z.literal(true), value: z.unknown() }),
            z.strictObject({ ok: z.literal(false), reason: z.string() }),
          ])
          .parse(
            bindings.bodies[route.data.salvage]!.run(
              freezePage(saved.value),
              freezePage({ page: owner.read()!.page, work: owner.read()!.work!.value, readings }),
            ),
          );
        if (!decoded.ok) throw Error(decoded.reason);
        const patches = admittedWorkPatches(
          route.data,
          bindings.schemas,
          decoded.value,
          route.resolvedWork?.schema,
        );
        const presentation = present("work.salvage", patches, evidence, route.data.salvagePresent);
        reviews.set("work.salvage", {
          presentation,
          invocation: issued.value,
          preview: patches,
          send: () => {
            if (!owner.current(issued.value) || !work.ready()) throw Error("Salvage is stale");
            return work.write(
              () => patches,
              issued.value,
              issued.value.id,
              "Salvage Work",
              issued.value,
            );
          },
        });
        notify();
        return { kind: "review", preview: patches };
      };
      const salvage = async () => {
        const scope = owner.read()?.scope;
        recoveryProblem = null;
        try {
          return await prepareSalvage();
        } catch (error) {
          if (owner.read()?.scope === scope) recoveryProblem = String(error);
          throw error;
        } finally {
          notify();
        }
      };
      const recovery = () => ({
        sentence:
          work.problem() === OLDER_WORK || work.problem() === UNREADABLE_WORK
            ? work.problem()
            : work.failure()
              ? null
              : recoverySentence,
        startFresh:
          fixture === null && (work.problem() === OLDER_WORK || work.problem() === UNREADABLE_WORK),
        carryOver: fixture === null && work.ready() && !!savedRecovery,
        busy: recoveryBusy,
        problem: recoveryProblem,
      });
      const startFresh = async () => {
        action();
        resolve();
        if (!recovery().startFresh || recoveryBusy) throw Error("Start fresh unavailable");
        const captured = owner.capture("work-recovery");
        const scope = owner.read()!.scope;
        const key = scope.identity.work!;
        recoverySentence = work.problem();
        recoveryBusy = true;
        recoveryProblem = null;
        notify();
        try {
          const result = await startFreshRouteWork(key);
          if (!owner.current(captured)) throw Error("Recovery is stale");
          if (!result.ok) throw Error("agentHint" in result ? result.agentHint : result.error);
          // The terminal failed subscription cannot observe reset. Reacquire with the
          // original admission, including its fingerprint, rather than accepting reset's ack.
          peReadings.dirty({
            ...key,
            kind: "work",
            admission: {
              routeKey: route.resolvedWork!.spec.route,
              fingerprint: route.workFingerprint,
            },
          });
          await work.reopen();
          if (!owner.current(captured)) throw Error("Recovery is stale");
          if (route.data.salvage) return await salvage();
          return null;
        } catch (error) {
          if (owner.read()?.scope === scope) recoveryProblem = String(error);
          throw error;
        } finally {
          if (owner.read()?.scope === scope) recoveryBusy = false;
          notify();
        }
      };
      const refreshReadings = (roots: Iterable<string>) => {
        for (const id of readingClosure(route, roots)) {
          demanded.add(id);
          invalidate(id);
          if (route.data.readings[id]?.kind === "use" && route.data.readings[id]?.geometry)
            geometry.refresh(id, false);
        }
        schedule();
      };
      let transport: ReturnType<typeof createAdmittedAddress> | undefined;
      let unsubscribeOwner = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        owner.close();
        unsubscribeOwner();
        transport?.close();
        for (const id of active.keys()) retire(id);
        geometry.close();
        work.close();
        environment.close();
        plan.close();
        registration.deactivate();
        for (const lease of leases.values()) lease.release();
        listeners.clear();
      };
      try {
        if (route.data.transition) schedule();
        transport = createAdmittedAddress({
          route,
          registry,
          owner,
          policy,
          address,
          memory,
          origin: { kind: "restore", source: "url", token: issuer.restore("url") },
        });
        if (transport.initial.kind === "refused" && !route.data.transition)
          throw Error(transport.initial.message);
        unsubscribeOwner = owner.subscribe(schedule);
        schedule();
      } catch (error) {
        close();
        throw error;
      }
      return {
        // The exact admission supplies both these schemas and field roles.
        page: ports.page as PagePort<G, S>,
        controls: ports.controls as FieldControls<G, S>,
        subscribe: (listener: () => void) => {
          if (closed) return () => {};
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        revision: () => revision,
        setWritable(next: boolean) {
          writable = next;
        },
        setVisible(next: boolean) {
          if (closed || visible === next) return;
          visible = next;
          if (!visible) {
            for (const id of active.keys()) retire(id);
            for (const id of Object.keys(route.data.readings)) geometry.suspend(id);
          } else schedule();
        },
        dispose: close,
        invoke,
        place,
        picker: (field: string) => pickerOptions[field],
        subjectDisplay: observers.subject,
        subjectText: observers.text,
        cells: cells.rows,
        salvage,
        recovery,
        startFresh,
        takeCell(id: string, key: unknown) {
          action();
          resolve();
          const declaration = route.data.cells[id];
          if (!declaration) throw Error(`Unknown cell: ${id}`);
          const context = () => {
            if (!work.ready()) throw Error("Work unavailable");
            for (const reading of declaration.deps.readings)
              if (!readings[reading]?.current) throw Error(`Reading unavailable: ${reading}`);
            return freezePage({
              page: project(declaration.deps.page, owner.read()!.page),
              work: project(
                declaration.deps.work,
                owner.read()!.work!.value as Record<string, unknown>,
              ),
              readings: Object.fromEntries(
                declaration.deps.readings.map((key) => [key, readings[key]]),
              ),
            });
          };
          context();
          const issued = owner.invocation(
            owner.capture(`cell-take:${id}`),
            Object.fromEntries(
              declaration.deps.readings.map((key) => [
                key,
                (readings[key] as { hash: string }).hash,
              ]),
            ),
          );
          if (!issued.ok) throw Error(issued.reason);
          return work.write(
            () => cells.take(id, key, context()),
            issued.value,
            issued.value.id,
            `Take ${id}`,
          );
        },
        focusCell(id: string, key: unknown) {
          action();
          resolve();
          const issued = owner.invocation(owner.capture(`cell-focus:${id}`), {});
          if (!issued.ok) throw Error(issued.reason);
          return owner.acceptPage(
            issued.value,
            cells.focus(id, key) as Parameters<typeof owner.acceptPage>[1],
          );
        },
        predicates: observers.predicates,
        visible: observers.visible,
        initialRestore: transport.initial,
        review: (id: string) => {
          const review = reviews.get(id);
          if (!review) return null;
          const stale = (!!route.data.work && !work.ready()) || !owner.current(review.invocation);
          return {
            preview: stale ? undefined : review.preview,
            sentence: stale ? null : (review.presentation?.sentence ?? null),
            rows: stale ? [] : (review.presentation?.rows ?? reviewChanges(review.preview)),
            stale,
          };
        },
        reviewRefusal: (id: string) => {
          const review = reviews.get(id);
          return review &&
            ((!!route.data.work && !work.ready()) || !owner.current(review.invocation))
            ? new ReviewRefusal("review-stale")
            : (reviewRefusals.get(id) ?? null);
        },
        reviewIds: () => Array.from(reviews.keys()),
        cancelReview: (id: string) => {
          const invocation = preparing.get(id)?.invocation ?? reviews.get(id)?.invocation;
          if (invocation) owner.retire(invocation.token);
          preparing.delete(id);
          reviews.delete(id);
          reviewRefusals.delete(id);
          schedule();
        },
        confirm: (id: string) => {
          const review = reviews.get(id);
          if (!review) throw reviewRefusals.get(id) ?? Error("No review to confirm");
          const result = review.send();
          reviews.delete(id);
          notify();
          return result;
        },
        work: () => owner.read()?.work ?? null,
        workBasis,
        queryLanding: (readingId: string) => queryLandings.get(readingId) ?? null,
        commandLanding: (id: string) => landings.get(id) ?? null,
        commandProblems: () =>
          [...landings.values(), ...queryLandings.values()].filter(
            (result) => result.kind === "result-undecodable",
          ),
        workProblem: work.problem,
        workFailure: work.failure,
        history,
        reread: () => work.reopen(),
        refusedEdits: work.refused,
        retryEdit: (id: string, basis: InvocationToken) => work.retry(id, basis),
        discardEdit: (id: string) => work.discard(id),
        retryCommand(id: string, currentBasis: InvocationToken) {
          action();
          const original = nativeAttempts.get(id);
          const key = owner.read()?.scope.identity.work;
          const receipt = key
            ? entryFor(key)
                .activity()
                .find((row) => row.id === id)
            : undefined;
          if (!original || !owner.current(original.basis) || !owner.current(currentBasis))
            throw Error(
              "Retry needs the original, still-current basis; re-read and prepare explicitly",
            );
          if (!receipt || !("notDispatched" in receipt && receipt.notDispatched))
            throw Error(
              "Only a confirmed undispatched command can retry; reconcile other outcomes",
            );
          return original.retry();
        },
        discardCommand(id: string) {
          nativeAttempts.delete(id);
          notify();
        },
        stopCommand(id: string) {
          action();
          const key = owner.read()?.scope.identity.work;
          const receipt = key
            ? entryFor(key)
                .activity()
                .find((row) => row.id === id)
            : undefined;
          if (!receipt || !["waiting", "running", "unknown"].includes(receipt.state))
            throw Error("Command is not pending in this Work");
          return cancelAction(id);
        },
        commands: () => {
          const key = owner.read()?.scope.identity.work;
          return key ? entryFor(key).activity() : [];
        },
        receiptWindow: () => {
          const key = owner.read()?.scope.identity.work;
          return key ? entryFor(key).receiptWindow() : null;
        },
        timeline: () => {
          const key = owner.read()?.scope.identity.work;
          if (!key) return [];
          const entry = entryFor(key);
          return freezePage(
            [...entry.timeline(), ...(sourceTimeline.get(entry) ?? [])].sort(
              (a, b) => Number(new Date(a.at)) - Number(new Date(b.at)),
            ),
          );
        },
        activity: () => {
          const key = owner.read()?.scope.identity.work;
          return key ? entryFor(key).activity() : [];
        },
        journal: () => journal()?.read() ?? null,
        journalRefusal: () =>
          !work.ready()
            ? "Work unavailable"
            : journalProblem?.journal === journal() &&
                journalProblem?.revision === journal()?.read().revision
              ? (journalProblem?.message ?? null)
              : null,
        restoreWork: restore,
        refreshable: Object.values(route.data.readings).some(
          (reading) => reading.refresh === "explicit",
        ),
        restore: () => transport!.restore(),
        paneDemand(pane: string) {
          if (!route.data.panes[pane]) throw Error(`Unknown pane: ${pane}`);
          return visible && paneDemand.get(pane) !== false && observers.visible(pane);
        },
        setPaneDemand(pane: string, next: boolean) {
          if (!route.data.panes[pane]) throw Error(`Unknown pane: ${pane}`);
          paneDemand.set(pane, next);
          schedule();
        },
        readingStatus(id: string): AdmittedReadingStatus {
          if (!route.data.readings[id]) throw Error(`Unknown reading: ${id}`);
          return Object.freeze({
            snapshot: readings[id] ?? {
              status: "unavailable" as const,
              current: false as const,
              reason: "Not read",
            },
            previous: previous.get(id),
            demanded: visible && wantedReadings().has(id),
            leased: !!active.get(id)?.handle || geometry.leased(id),
          });
        },
        refreshPane(pane: string) {
          if (!route.data.panes[pane]) throw Error(`Unknown pane: ${pane}`);
          refreshReadings(route.data.panes[pane]!.draws);
        },
        refresh(id?: string) {
          resolve();
          refreshReadings(id === undefined ? wantedReadings() : [id]);
        },
        read(pane: string) {
          const current = resolve();
          if (!Object.hasOwn(route.data.panes, pane)) throw Error(`Unknown pane: ${pane}`);
          const declaration = route.data.panes[pane]!;
          if (!observers.visible(pane) || !declaration.body) return null;
          const basis = workBasis();
          drawing = true;
          try {
            return current.bodies[declaration.body]!.run({
              place: (row: unknown, input: unknown) => place(pane, row, input, basis),
              page: ports.page,
              work: owner.read()!.work?.value ?? null,
              workBasis: basis,
              history,
              recovery: route.data.work
                ? { state: recovery, startFresh, carryOver: salvage }
                : undefined,
              readings: Object.freeze(
                Object.fromEntries(declaration.draws.map((id) => [id, readings[id]])),
              ),
              readingActions: Object.fromEntries(
                declaration.draws
                  .filter((id) => geometry.actions[id])
                  .map((id) => [id, geometry.actions[id]]),
              ),
              readCosts: Object.freeze({ ...geometry.costs }),
              visible: true,
              verbs: Object.fromEntries(
                ("allowed" in declaration.verbs
                  ? declaration.verbs.allowed
                  : declaration.verbs
                ).map((id: string) => [
                  id,
                  (input: unknown, editBasis?: InvocationToken) => {
                    if (route.data.verbs[id]?.kind === "work" && !editBasis)
                      throw Error("Work edit requires its rendered accepted basis");
                    return invoke(id, input, editBasis);
                  },
                ]),
              ),
            });
          } finally {
            drawing = false;
          }
        },
        close,
      };
    },
  };
}
export type AdmittedMount = ReturnType<ReturnType<typeof createRouteShell>["mount"]>;
