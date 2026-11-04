import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { EntryTable } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import {
createRouteEnvironmentIssuer,
type KernelServices
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { FieldControls,InvocationToken,PagePort,SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import {
createAdmittedRouteRegistry,
resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { createAdmittedAddress } from "./admitted-address";
import { createAdmittedCellActions,createAdmittedCells } from "./admitted-cells";
import { createAdmittedGeometry } from "./admitted-geometry";
import { createAdmittedHistory } from "./admitted-history.ts";
import { createAdmittedInvocation } from "./admitted-invoke.ts";
import { createAdmittedObservers } from "./admitted-observers";
import type { PlaceInput } from "./admitted-place";
import { createAdmittedReadings } from "./admitted-readings.ts";
import { createAdmittedScope } from "./admitted-scope.ts";
import { createAdmittedWork } from "./admitted-work";
import {
createApplicationWorkRegistry
} from "./application-work-registry";
import { fixtureGeometryDoor } from "./fixture-geometry-door";
import { createNamedFixtureRouteEnvironment } from "./fixture-lane";
import { createPagePorts,freezePage } from "./page-port";
import { createRouteEnvironment,type EnvironmentValidation } from "./route-environment";
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

export { admittedMountBodyKinds } from "./admitted-scope.ts";

export class PlaceWriteRefusal extends Error {
  readonly kind = "refused";
  readonly reason = "place-read-only";
  constructor() {
    super("Place is not writable");
    this.name = "PlaceWriteRefusal";
  }
}
/** One shell composition owns its feed, journals and source timeline. */
export function createRouteShell(services: Omit<KernelServices, "target">) {
  const liveDoor = services.work ?? createWorkFeedClient();
  const workRegistry = createApplicationWorkRegistry();
  const sourceTimeline = new WeakMap<object, import("../../../../packages/runtime/src/work-journal.ts").TimelineEntry[]>();
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
      const scope = createAdmittedScope({route, input, workRegistry, snapshots: () => readings.snapshots(),
        closed: () => closed, observeReceipts: () => readings.observeReceipts(), notify: () => notify()});
      const {registry, registration, resolve, bindings, policy, issuer, owner, read, entryFor, mountJournal, workSpec} = scope;
      const observers = createAdmittedObservers(route.data, bindings.bodies);
      const cells = createAdmittedCells(
        route.data,
        bindings.schemas,
        bindings.bodies,
        route.resolvedWork?.schema,
      );
      const ports = createPagePorts(route.data, { ...owner, readPage: () => read().page });
      const environmentIssuer = createRouteEnvironmentIssuer();
      let closed = false;
      let resources: "held" | "released" = "held";
      const listeners = new Set<() => void>();
      let drawing = false;
      let revision = 0;
      const notify = () => {
        if (!closed) {
          revision++;
          listeners.forEach((listener) => listener());
        }
      };
      const schedule = (): void => readings.sync();
      const readings: ReturnType<typeof createAdmittedReadings<W>> = createAdmittedReadings({ route, owner, read, bindings, input, services,
        environmentIssuer, observers, cells, geometry: () => geometry, environment: () => environment,
        schedule, notify, settle: () => {resolve(); work.sync(); historyOwner.sync();},
        syncInvocation: () => invocation.sync(),
        beforeSync: () => {if (drawing) throw Error("Admitted observers cannot run during render");},
        available: () => !closed && resources === "held" && input.custody.current(), closed: () => closed,
        entryFor, resolve, logEvidence: (readingId, value) => {
          const key = read().scope.identity.work;
          if (!key) return;
          const entry = entryFor(key);
          const rows = sourceTimeline.get(entry) ?? [];
          rows.push(freezePage({kind: "feed", at: services.clock.now(), subject: readingId, basis: value}));
          if (rows.length > 200) rows.shift();
          sourceTimeline.set(entry, rows);
        },
      });
      const {plan, queryInputs, queryLandings, demanded, generations, retire} = readings;
      const validate: EnvironmentValidation = {
        admitted: (candidate) => candidate === route && registry.resolve(route) === route,
        token: (token) => owner.current(token),
        scope: (scope) => owner.current(scope),
        invocation: (invocation) => owner.current(invocation),
        key: (key) =>
          readings.ownsKey(key),
        detail: () => false,
        geometryScope: () => false,
      };
      const environment: ReturnType<typeof createRouteEnvironment> = (() => {
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
      const geometry = createAdmittedGeometry({
        route,
        owner,
        issuer: environmentIssuer,
        entries: bindings.entries,
        door: fixture === null ? services.geometry : fixtureGeometryDoor(plan.seed(fixture)),
        notify: () => schedule(),
      });
      const action = () => {
        if (drawing) throw Error("Admitted action cannot run during render");
        if (invocation.presenting()) throw Error("Admitted action cannot run during presentation");
        if (closed) throw Error("Mount closed");
        if (!input.custody.current() || input.target === null) throw new PlaceWriteRefusal();
      };
      const invocation = createAdmittedInvocation({ route, owner, read, work, bindings, door,
        fixture, target, services, action, resolve, notify, schedule,
        snapshots: readings.snapshots, queryInputs, queryLandings, demanded, generations, retire, geometry });
      const { invoke, place, workBasis } = invocation;
      const historyOwner = createAdmittedHistory({route, owner, read, work, bindings, fixture,
        action, resolve, notify, closed: () => closed, snapshots: readings.snapshots, mountJournal, invocation});
      const {history, salvage, recovery, startFresh, restore, journal} = historyOwner;
      let transport: ReturnType<typeof createAdmittedAddress> | undefined;
      let unsubscribeOwner = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        owner.close();
        unsubscribeOwner();
        transport?.close();
        readings.suspend();
        geometry.close();
        work.close();
        environment.close();
        plan.close();
        registration.deactivate();
        scope.release();
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
        snapshots: readings.snapshots, action, resolve});
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
          readings.suspend();
          for (const id of Object.keys(route.data.readings)) geometry.suspend(id);
        },
        dispose: close,
        invoke,
        place,
        picker: readings.picker,
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
        journalRefusal: historyOwner.journalRefusal,
        restoreWork: restore,
        refreshable: Object.values(route.data.readings).some(
          (reading) => reading.refresh === "explicit",
        ),
        restore: () => transport!.restore(),
        ...readings.public,
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
                Object.fromEntries(declaration.draws.map((id) => [id, readings.snapshots()[id]])),
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

