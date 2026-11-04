import { bindWork,OLDER_WORK,UNREADABLE_WORK,workKey } from "@pe/agent-contracts";
import { z } from "zod";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { EntryTable,ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import {
canonicalEnvironmentInput,
createRouteEnvironmentIssuer,
type KernelServices,
type ReadHandle,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { FieldControls,InvocationToken,PagePort,SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import {
createAdmittedRouteRegistry,
resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { routeWorkSubject } from "../../../../packages/agent-contracts/src/route-work-subject";
import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { createWorkJournal } from "../../../../packages/runtime/src/work-journal";
import { peReadings } from "../readings";
import { salvageRouteWork,startFreshRouteWork } from "../route/host";
import { createAdmittedAddress } from "./admitted-address";
import { admittedWorkPatches,createAdmittedCellActions,createAdmittedCells } from "./admitted-cells";
import { type CommandResultDecode } from "./admitted-command-result";
import { project } from "./admitted-context.ts";
import { createAdmittedGeometry } from "./admitted-geometry";
import { createAdmittedInvocation } from "./admitted-invoke.ts";
import { createAdmittedObservers } from "./admitted-observers";
import type { PlaceInput } from "./admitted-place";
import {
createAdmittedReadingPlan,
readingClosure,
receiptHitsReading,
type AdmittedReadingStatus,
} from "./admitted-reading-plan";
import { createAdmittedWork } from "./admitted-work";
import {
applicationWorkRegistry,
createApplicationWorkRegistry,
} from "./application-work-registry";
import { fixtureGeometryDoor } from "./fixture-geometry-door";
import { createNamedFixtureRouteEnvironment } from "./fixture-lane";
import { createPagePolicy,createPagePorts,freezePage } from "./page-port";
import { createRouteEnvironment,type EnvironmentValidation } from "./route-environment";
import { sourceReadingEvidence } from "./source-route-services";
import { createWorkFeedClient } from "./work-feed-client";
export { ReviewRefusal } from "./admitted-invoke.ts";

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

export class PlaceWriteRefusal extends Error {
  readonly kind = "refused";
  readonly reason = "place-read-only";
  constructor() {
    super("Place is not writable");
    this.name = "PlaceWriteRefusal";
  }
}
/** Application services are installed once. Routes supply only admission and location. */
const applicationWorkDoor = createWorkFeedClient();
const sourceTimeline = new WeakMap<
  object,
  import("../../../../packages/runtime/src/work-journal").TimelineEntry[]
>();
const registriesByDoor = new WeakMap<object, ReturnType<typeof createApplicationWorkRegistry>>();
export function createRouteShell(services: Omit<KernelServices, "target">) {
  const liveDoor = services.work ?? applicationWorkDoor;
  let scopedRegistry = registriesByDoor.get(liveDoor);
  if (!scopedRegistry) {
    scopedRegistry = services.work ? createApplicationWorkRegistry() : applicationWorkRegistry;
    registriesByDoor.set(liveDoor, scopedRegistry);
  }
  const workRegistry = scopedRegistry;
  return {
    mount<
      G extends RouteGraphJson,
      S extends SchemaTable,
      E extends EntryTable,
      Render,
      W extends Record<string, unknown>,
    >(admitted: AdmittedRoute<G, S, E, Render, W>, input: PlaceInput) {
      const { address, fixture, target, memory } = input;
      const route = admitted;
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
      const policy = createPagePolicy<RouteGraphJson, SchemaTable>(
        route.data,
        bindings.schemas,
        () => "unresolved",
        route.data.transition
          ? (current, patch, origin) => {
              const deps = route.data.transitionDeps ?? { page: [], work: [], readings: [] };
              if (deps.readings.some((id) => !readings[id]?.current))
                return { ok: false, reason: "Transition reading evidence unavailable or stale" };
              const acceptedWork = owner.read()?.work?.value;
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
      const identityForPage = (page: Readonly<Record<string, unknown>>) => ({
        target,
        work: route.data.work
          ? bindWork(
              route.data.work.route,
              input.work.address,
              routeWorkSubject(route.data, bindings, page) ??
                address.read().get("work") ??
                undefined,
              input.work.open ?? undefined,
            )
          : null,
      });
      const registryForWork = fixture === null ? workRegistry : createApplicationWorkRegistry();
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
      const workSpec = route.resolvedWork
        ? {
            route: route.resolvedWork.spec.route,
            title: route.data.name,
            description: "",
            schema: route.resolvedWork.schema,
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
      const owner = createRouteScopeGate<RouteGraphJson, SchemaTable, W>(
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
      const read = () => {
        const snapshot = owner.read();
        if (!snapshot) throw Error("Mount has no accepted snapshot");
        return snapshot;
      };
      const ports = createPagePorts(route.data, { ...owner, readPage: () => read().page });
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
      let resources: "held" | "released" = "held";
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
              Object.freeze({
                status: "unavailable" as const,
                current: false as const,
                value: previous.get(key),
                reason: "Host evidence changed",
              }),
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
          if (input.custody.current() && paneDemand.get(id) !== false && observers.visible(id))
            pane.draws.forEach((reading) => roots.add(reading));
        // Picker/observers and active invocations are consumers too.
        for (const field of Object.values(route.data.fields))
          if (
            field.role === "subject" &&
            input.custody.current() &&
            paneDemand.get(route.data.subject.pane) !== false &&
            observers.visible(route.data.subject.pane)
          )
            roots.add(field.picker.reading);
        for (const id of queryInputs.keys()) roots.add(id);
        return readingClosure(route, roots);
      };
      const environment = (() => {
        try {
          return fixture === null
            ? createRouteEnvironment({
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
              })
            : createNamedFixtureRouteEnvironment({
                issuer: environmentIssuer,
                validate,
                plan,
                name: fixture,
                workSpec,
                now: () => services.clock.now(),
              });
        } catch (error) {
          owner.close();
          plan.close();
          registration.deactivate();
          throw error;
        }
      })();
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
        () => action(),
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
      let evidenceScope = read().scope;
      let drawing = false;
      let scheduling = false;
      let again = false;
      const schedule = () => {
        if (drawing) throw Error("Admitted observers cannot run during render");
        if (closed || resources === "released" || !input.custody.current()) return;
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
            if (evidenceScope !== read().scope) {
              evidenceScope = read().scope;
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
              page: read().page,
              work: read().work?.value ?? null,
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
                (declaration.demand === "subject" && read().page[subjectField] === null)
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
                  page: read().page,
                  work: owner.read()?.work?.value ?? null,
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
                  if (
                    saved?.signature === signature &&
                    !active.has(readingId) &&
                    route.data.readings[readingId]!.kind === "use"
                  ) {
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
            cells.update(read().work?.value ?? null);
            observers.update({
              page: read().page,
              work: read().work?.value ?? null,
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
                read().page,
              );
              owner.acceptPage(landing.value, patch as Parameters<typeof owner.acceptPage>[1]);
            }
            for (const [key, field] of Object.entries(route.data.fields)) {
              if (field.role === "subject")
                pickerOptions[key] = freezePage(
                  bindings.bodies[field.picker.options]!.run(readings[field.picker.reading]),
                );
            }
            invocation.sync();
          } while (again && !closed);
        } finally {
          scheduling = false;
        }
        notify();
      };
      const action = () => {
        if (drawing) throw Error("Admitted action cannot run during render");
        if (invocation.presenting()) throw Error("Admitted action cannot run during presentation");
        if (closed) throw Error("Mount closed");
        if (!input.custody.current() || input.target === null) throw new PlaceWriteRefusal();
      };
      const invocation = createAdmittedInvocation({ route, owner, read, work, bindings, door,
        fixture, target, services, action, resolve, notify, schedule,
        snapshots: () => readings, queryInputs, queryLandings, demanded, generations, retire, geometry });
      const { invoke, place, workBasis, present, reviews } = invocation;
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
            expectedRevision: read().work!.revision,
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
            get entries() {
              return freezePage(journal()?.entries() ?? []);
            },
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
            page: project(deps.page, read().page),
            work: project(deps.work, read().work!.value),
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
              freezePage({ page: read().page, work: read().work!.value, readings }),
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
              { label: "Salvage Work" },
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
        const scope = read().scope;
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
        // Schedule before the address transport hears a move: its URL push makes retained-route
        // custody stale until the router re-renders, so a later listener would see no custody and
        // drop the move (every subject, query and pose move rendered nothing; 2026-11-03).
        unsubscribeOwner = owner.subscribe(schedule);
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
        schedule();
      } catch (error) {
        close();
        throw error;
      }
      const transitionCell = createAdmittedCellActions({route, owner, read, work, cells,
        snapshots: () => readings, action, resolve});
      return {
        // The exact admission supplies both these schemas and field roles.
        page: ports.page as PagePort<G, S>,
        controls: ports.controls as FieldControls<G, S>,
        subscribe: (listener: () => void) => {
          if (closed) return () => {};
          if (resources === "released" && input.custody.current()) {
            resources = "held";
            schedule();
          }
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        revision: () => revision,
        release() {
          if (closed) return;
          resources = "released";
          for (const id of active.keys()) retire(id);
          for (const id of Object.keys(route.data.readings)) geometry.suspend(id);
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
        takeCell: (id: string, key: unknown) => transitionCell("take", id, key),
        unsuggestCell: (id: string, key: unknown) => transitionCell("unsuggest", id, key),
        clearCell: (id: string, key: unknown) => transitionCell("clear", id, key),
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
        ...invocation.public,
        work: () => owner.read()?.work ?? null,
        workBasis,
        queryLanding: (readingId: string) => queryLandings.get(readingId) ?? null,
        commandLanding: invocation.commandLanding,
        commandProblems: () =>
          [...invocation.landings(), ...queryLandings.values()].filter(
            (result) => result.kind === "result-undecodable",
          ),
        workProblem: work.problem,
        workFailure: work.failure,
        history,
        refusedEdits: work.refused,
        retryEdit: (id: string, basis: InvocationToken) => work.retry(id, basis),
        discardEdit: (id: string) => work.discard(id),
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
            demanded: input.custody.current() && wantedReadings().has(id),
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
              work: read().work?.value ?? null,
              workBasis: basis,
              history,
              cells: {
                take: (id: string, key: unknown) => transitionCell("take", id, key),
                unsuggest: (id: string, key: unknown) => transitionCell("unsuggest", id, key),
                clear: (id: string, key: unknown) => transitionCell("clear", id, key),
              },
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
