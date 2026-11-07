import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission.ts";
import type { EntryTable } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import {
  createRouteEnvironmentIssuer,
  type KernelServices,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type {
  FieldControls,
  InvocationToken,
  PagePort,
  SchemaTable,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module.ts";
import * as recoveryHost from "../route/host.ts";
import { createAdmittedAddress } from "./admitted-address.ts";
import { createAdmittedBody } from "./admitted-body.ts";
import { createAdmittedCellActions, createAdmittedCells } from "./admitted-cells.ts";
import type { MountContext } from "./admitted-context.ts";
import { createAdmittedGeometry } from "./admitted-geometry.ts";
import { createAdmittedHistory } from "./admitted-history.ts";
import { createAdmittedInvocation } from "./admitted-invoke.ts";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import { observeSubject, subjectScopeKey, type SubjectState } from "./subject";
import { openSet, type OpenSet } from "./open-set.neutral";
import { z } from "zod";
import { createAdmittedObservers } from "./admitted-observers.ts";
import type { PlaceInput } from "./admitted-place.ts";
import { createAdmittedReadings } from "./admitted-readings.ts";
import { createAdmittedEnvironment, createAdmittedScope } from "./admitted-scope.ts";
import { createAdmittedWork } from "./admitted-work.ts";
import { createApplicationWorkRegistry } from "./application-work-registry.ts";
import { fixtureGeometryDoor } from "./fixture-geometry-door.ts";
import { recordedWorkDoor } from "./history.ts";
import { createNamedFixtureRouteEnvironment } from "./fixture-lane";
import { createAttention } from "./admitted-attention.ts";
import { createPagePorts } from "./page-port.ts";
import { createRouteEnvironment } from "./route-environment.ts";
import { sourceReadingEvidence } from "./source-route-services.ts";
import { createWorkFeedClient } from "./work-feed-client.ts";

/** This mount door never translates an executable legacy graph. Recheck before every draw. */
export function mountAdmittedRoute(route: AdmittedRoute, expectedFingerprint: string) {
  if (route.fingerprint !== expectedFingerprint) throw Error("Stale route stamp at mount");
  const registry = createAdmittedRouteRegistry();
  const receipt = registry.register(route);
  return {
    registry,
    registration: receipt,
    resolve() {
      const bindings = resolveRouteBindings(registry, route);
      if (!bindings) throw Error("Foreign or retired mount admission");
      if (route.fingerprint !== expectedFingerprint) throw Error("Stale route stamp at mount");
      return bindings;
    },
    close: () => receipt.deactivate(),
  };
}

export class PlaceWriteRefusal extends Error {
  readonly kind = "refused";
  readonly reason = "place-read-only";
  constructor() {
    super("Place is not writable");
    this.name = "PlaceWriteRefusal";
  }
}
/** One shell composition owns its feed, journals and source timeline. */
export function createRouteShell(
  services: Omit<KernelServices, "target">,
  settings?: import("./settings").SettingsOwner,
) {
  const workRegistry = createApplicationWorkRegistry();
  const sourceTimeline = new WeakMap<
    object,
    import("../../../../packages/runtime/src/work-journal.ts").TimelineEntry[]
  >();
  return {
    mount<
      G extends RouteGraphJson,
      S extends SchemaTable,
      E extends EntryTable,
      Render,
      W extends Record<string, unknown>,
    >(admitted: AdmittedRoute<G, S, E, Render, W>, input: PlaceInput) {
      const { address, fixture, target, memory } = input;
      const liveDoor = input.history ? recordedWorkDoor(input.history) : (services.work ?? createWorkFeedClient());
      const routeSettings = fixture === null && !input.history ? settings : undefined;
      const route = admitted;
      const scope = createAdmittedScope({
        admission: mountAdmittedRoute(route, route.fingerprint),
        route,
        input,
        workRegistry: fixture === null && !input.history ? workRegistry : createApplicationWorkRegistry(),
        snapshots: () => readings.snapshots(),
        closed: () => closed,
        observeReceipts: () => readings.observeReceipts(),
        notify: () => notify(),
      });
      const { registry, registration, bindings, policy, issuer, owner, read, entryFor } = scope;
      const observers = createAdmittedObservers(route.data, bindings.bodies);
      const cells = createAdmittedCells(
        route.data,
        bindings.schemas,
        bindings.bodies,
        route.resolvedWork?.schema,
      );
      const ports = createPagePorts(route.data, {
        ...owner,
        readPage: () => ({ ...read().page, ...routeSettings?.read().values }),
        movePage(patch, origin) {
          if (origin.kind === "human" && origin.source === "setting" && routeSettings) {
            if (routeSettings.read().revision < 0 || routeSettings.read().pending)
              return {
                kind: "refused",
                code: "settings",
                message: "Wait for settings to finish loading or saving",
              };
            void routeSettings.set(patch).catch(() => notify());
            return {
              kind: "accepted",
              revision: routeSettings.read().revision,
              changed: false,
              membership: "unresolved",
            };
          }
          return owner.movePage(patch, origin);
        },
      });
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
      const evidence = sourceReadingEvidence(services);
      const submitNative: NonNullable<KernelServices["submitNative"]> = (command) => {
        if (input.history || input.readOnly) throw Error("needs live Revit");
        if (!door) throw Error("Native commands unavailable");
        return fixture === null
          ? services.submitNative
            ? services.submitNative(command)
            : (services.nativeWrite ?? door).submit(command)
          : door.submit(command);
      };
      const context: MountContext<W> = {
        ...scope,
        route,
        input,
        environmentIssuer,
        ports,
        cells,
        observers,
        work: () => work,
        geometry: () => geometry,
        environment: () => environment,
        readings: () => readings,
        invocation: () => invocation,
        history: () => historyOwner,
        cellActions: () => transitionCell,
        notify,
        schedule,
        action: () => action(),
        closed: () => closed,
        available: () => !closed && resources === "held" && input.custody.current(),
        beforeSync: () => {
          if (drawing) throw Error("Admitted observers cannot run during render");
        },
        duringDraw<T>(draw: () => T): T {
          drawing = true;
          try {
            return draw();
          } finally {
            drawing = false;
          }
        },
        recoveryHost: fixture === null && !input.history ? recoveryHost : undefined,
        sourceEvidence: {
          dependencies: evidence?.dependencies.bind(evidence),
          observe: fixture === null && !input.history ? evidence?.observe.bind(evidence) : undefined,
        },
        submitNative,
        local: fixture === null ? services.local : undefined,
        sourceTimeline,
        now: services.clock.now.bind(services.clock),
      };
      const readings = createAdmittedReadings(context);
      const plan = readings.plan;
      const queryLandings = readings.queryLandings;
      const environment = createAdmittedEnvironment(context, (validate) =>
        fixture === null
          ? createRouteEnvironment({
              issuer: environmentIssuer,
              validate,
              ports: {
                ...services,
                work: route.data.work ? { read: liveDoor, submit: liveDoor } : undefined,
                submitNative,
                geometry: undefined,
              },
            })
          : createNamedFixtureRouteEnvironment({
              issuer: environmentIssuer,
              validate,
              plan,
              name: fixture,
              workSpec: scope.workSpec,
              now: () => services.clock.now(),
            }),
      );
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
        if (!input.custody.current() || target === null) throw new PlaceWriteRefusal();
      };
      const invocation = createAdmittedInvocation(context);
      const { invoke, place, workBasis } = invocation;
      const historyOwner = createAdmittedHistory(context);
      let transport: ReturnType<typeof createAdmittedAddress> | undefined;
      let unsubscribeOwner = () => {};
      let stopSubject = () => {};
      let stopCustody = () => {};
      let stopSettings = () => {};
      const close = () => {
        if (closed) return;
        invocation.close();
        closed = true;
        stopSubject();
        stopCustody();
        stopSettings();
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
        if (routeSettings) {
          const disconnect = routeSettings.connect();
          const unsubscribe = routeSettings.subscribe(notify);
          stopSettings = () => {
            unsubscribe();
            disconnect();
          };
        }
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
      const transitionCell = createAdmittedCellActions(context);
      const mounted = {
        // The exact admission supplies both these schemas and field roles.
        page: ports.page as PagePort<G, S>,
        controls: ports.controls as FieldControls<G, S>,
        // ADR 0030 rule 10: attention projects the agent fields with this admission's codecs; null opts out.
        attention: createAttention(route.data.fields, bindings.codecs),
        /** Pea's only Page door: a pea-origin owner move, fenced to agent "set" keys by the page policy. */
        peaMove: (patch: Record<string, unknown>) => {
          const basis = owner.invocation(owner.capture("pea:attention"), {});
          const lease = basis.ok ? issuer.lease(basis.value) : basis;
          if (!lease.ok) return { kind: "refused" as const, code: "lease", message: lease.reason };
          const result = owner.acceptPage(
            lease.value,
            patch as Parameters<typeof owner.acceptPage>[1],
          );
          if (result.kind === "refused") return result;
          const accepted = read();
          return {
            ...result,
            receipt: {
              current: () =>
                !closed &&
                owner.read()?.scope === accepted.scope &&
                owner.read()?.pageRevision === accepted.pageRevision,
              rendered: (page: object) =>
                canonicalEnvironmentInput(page) === canonicalEnvironmentInput(accepted.page),
            },
          };
        },
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
          invocation.suspend();
          resources = "released";
          readings.suspend();
          for (const id of Object.keys(route.data.readings)) geometry.suspend(id);
        },
        dispose: close,
        invoke,
        place,
        picker: readings.picker,
        subjectState(search: Record<string, unknown>): SubjectState | null {
          // A pin can change without changing the resolved document. Compare the Place's
          // current address; a mount-time URL stamp would strand its retained href before the pin.
          if (subjectScopeKey(search) !== subjectScopeKey(Object.fromEntries(address.read()))) return null;
          const refuse = (refusal: string | null): SubjectState => ({
            ready: false,
            refusal,
            label: "",
            link: null,
          });
          if (!context.available())
            return refuse("Place is inactive or retired");
          // Resolve again: equal revision numbers never authorize a foreign/retired admission.
          if (!resolveRouteBindings(registry, route)) return refuse("Route admission is retired");
          const subject = route.data.subject;
          const field = route.data.fields[subject.field];
          if (field?.role !== "subject") return refuse("Subject declaration is unavailable");
          let value = read().page[subject.field];
          if (search[subject.field] !== undefined) {
            const raw = search[subject.field];
            if (typeof raw !== "string") return refuse(`${subject.noun} is malformed`);
            try {
              const decoded = z
                .object({ ok: z.literal(true), value: z.unknown() })
                .safeParse(bindings.codecs[field.codec]!.decode(raw));
              if (!decoded.success) return refuse(`${subject.noun} is malformed`);
              const parsed = bindings.schemas[field.schema]!.safeParse(decoded.data.value);
              if (!parsed.success) return refuse(`${subject.noun} is malformed`);
              value = parsed.data;
            } catch {
              return refuse(`${subject.noun} codec failed`);
            }
          }
          let selection: OpenSet<unknown> = { kind: "ids", ids: [] };
          if (field.cardinality === "many") {
            // Admission validated the field schema; narrow its kernel Many shape without a cast.
            if (!value || typeof value !== "object" || !("kind" in value))
              return refuse(`${subject.noun} is malformed`);
            if (value.kind === "all") selection = { kind: "all" };
            else if (value.kind === "ids" && "ids" in value && Array.isArray(value.ids))
              selection = { kind: "ids", ids: value.ids };
            else return refuse(`${subject.noun} is malformed`);
          }
          // Empty is an accepted Page fact, not an assertion that the native roster is empty/available.
          const empty =
            field.cardinality === "many"
              ? selection.kind === "ids" && !selection.ids.length
              : value == null;
          const roster = readings.public.readingStatus(field.picker.reading).snapshot;
          if (!roster.current && !empty) return refuse(roster.reason);
          const parsedOptions = z
            .array(z.object({ id: z.unknown(), label: z.string() }))
            .safeParse(readings.picker(subject.field));
          if (!parsedOptions.success && !empty) return refuse("Subject roster is malformed");
          const options = parsedOptions.success ? parsedOptions.data : [];
          const key = canonicalEnvironmentInput;
          const set = openSet(
            key,
            options.map((option) => option.id),
          );
          const ids =
            field.cardinality === "many" ? set.members(selection) : value == null ? [] : [value];
          if (ids.some((id) => !options.some((option) => key(option.id) === key(id))))
            return refuse(
              `A ${subject.noun} in this link is not in this model; choose it again from the roster`,
            );
          if (
            canonicalEnvironmentInput(value) !==
            canonicalEnvironmentInput(read().page[subject.field])
          )
            return null;
          let link: string;
          try {
            link = transport!.link();
          } catch {
            return refuse("Subject Page encoding failed");
          }
          return {
            ready: true,
            refusal: null,
            link,
            label:
              field.cardinality === "many" && selection.kind === "all"
                ? `All ${subject.noun}s`
                : ids
                    .map((id) => options.find((option) => key(option.id) === key(id))!.label)
                    .join(" + "),
          };
        },
        subjectDisplay: observers.subject,
        subjectText: observers.text,
        cells: cells.rows,
        ...transitionCell.public,
        predicates: observers.predicates,
        visible: observers.visible,
        initialRestore: transport.initial,
        ...invocation.public,
        ...historyOwner.public,
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
        refusedEdits: work.refused,
        retryEdit: (id: string, basis: InvocationToken) => work.retry(id, basis),
        discardEdit: (id: string) => work.discard(id),
        refreshable: Object.values(route.data.readings).some(
          (reading) => reading.refresh === "explicit",
        ),
        restore: () => transport!.restore(),
        ...readings.public,
        read: createAdmittedBody(context),
        close,
      };
      // A retained tab can subscribe before the router publishes its current tag. The later
      // address notification must retry acquisition even when Page itself did not change.
      stopCustody = address.subscribe(() => {
        if (resources !== "released" || !listeners.size || !input.custody.current()) return;
        resources = "held";
        schedule();
      });
      stopSubject = observeSubject(route.data.key, {
        current: () => input.custody.current(),
        read: mounted.subjectState,
        subscribe: mounted.subscribe,
      });
      return mounted;
    },
  };
}
export type AdmittedMount = ReturnType<ReturnType<typeof createRouteShell>["mount"]>;
