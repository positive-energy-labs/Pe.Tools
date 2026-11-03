import { bindWork, workKey } from "@pe/agent-contracts";
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
import { createAdmittedReadingPlan } from "./admitted-reading-plan";
import { createRouteEnvironment, type EnvironmentValidation } from "./route-environment";
import { createNamedFixtureRouteEnvironment, selectRouteEnvironment } from "./fixture-lane";

/** Application services are installed once. Routes supply only admission and location. */
export function createRouteShell(services: KernelServices) {
  const liveDoor = services.work ?? createWorkFeedClient();
  const journals = new Map<string, ReturnType<typeof createWorkJournal>>();
  const journalFor = (key: import("@pe/agent-contracts").WorkKey) => {
    const id = workKey(key);
    let journal = journals.get(id);
    if (!journal) {
      journal = createWorkJournal(key);
      journals.set(id, journal);
    }
    return journal;
  };
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
      const policy = createPagePolicy(route.data, bindings.schemas, () => "unresolved");
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
              route.data.workSubject
                ? typeof page[route.data.workSubject] === "string"
                  ? (page[route.data.workSubject] as string)
                  : page[route.data.workSubject] == null
                    ? "default"
                    : canonicalEnvironmentInput(page[route.data.workSubject])
                : (address.read().get("work") ?? undefined),
              target?.kind === "document" ? target.ref : undefined,
            )
          : null,
      });
      const fixtureJournals = new Map<string, ReturnType<typeof createWorkJournal>>();
      const mountJournal =
        fixtureName(Object.fromEntries(address.read())) === null
          ? journalFor
          : (key: import("@pe/agent-contracts").WorkKey) => {
              const id = workKey(key);
              let journal = fixtureJournals.get(id);
              if (!journal) {
                journal = createWorkJournal(key);
                fixtureJournals.set(id, journal);
              }
              return journal;
            };
      const workSpec = route.data.work
        ? {
            route: route.data.work.route,
            title: route.data.name,
            description: "",
            schema: bindings.schemas[route.data.work.schema]!,
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
      const work = createAdmittedWork(route, owner, door, () => schedule());
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
        read.unsubscribe?.();
        read.handle?.release();
      };
      const demanded = new Set<string>();
      const subjectField = route.data.subject.field;
      let readings: Record<string, ReadingSnapshot<unknown>> = {};
      let scheduling = false;
      let again = false;
      const schedule = () => {
        if (closed) return;
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
            geometry.syncSubject();
            const used = new Set<string>();
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
                  const dependencyFields = route.data.readings[readingId]!.deps.page;
                  const signature = canonicalEnvironmentInput({
                    key: request.key,
                    work: owner.read()!.work,
                    page: Object.fromEntries(
                      dependencyFields.map((key) => [key, owner.read()!.page[key]]),
                    ),
                  });
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
                      snapshot: { status: "pending", current: false, reason: "Reading pending" },
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
                        record.snapshot = freezePage(snapshot);
                        return;
                      }
                      const parsed = request.output.safeParse(snapshot.value);
                      record.snapshot = parsed.success
                        ? freezePage({ ...snapshot, value: parsed.data })
                        : { status: "failed", current: false, reason: parsed.error.message };
                    };
                    accept(record.handle.read());
                    record.unsubscribe = environment.environment.readings.subscribe(
                      request,
                      record.token,
                      (snapshot) => {
                        accept(snapshot);
                        schedule();
                      },
                    );
                    read = record;
                  }
                  return read.snapshot;
                },
                geometry.read,
              );
            }
            for (const id of active.keys()) if (!used.has(id)) retire(id);
            readings = Object.freeze(next);
          } while (again && !closed);
        } finally {
          scheduling = false;
        }
        notify();
      };
      const reviews = new Map<
        string,
        {
          invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken;
          send(): unknown;
          preview: unknown;
        }
      >();
      const project = (keys: readonly string[], value: Readonly<Record<string, unknown>>) =>
        freezePage(Object.fromEntries(keys.map((key) => [key, value[key]])));
      const invoke = (id: string, input: unknown) => {
        resolve();
        const declaration = route.data.verbs[id];
        if (!declaration) throw Error(`Unknown verb: ${id}`);
        const parsed = bindings.schemas[declaration.input]!.parse(input);
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
          page: project(declaration.deps.page, owner.read()!.page),
          work: project(
            declaration.deps.work,
            (owner.read()!.work?.value as Record<string, unknown>) ?? {},
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
          const patches = () =>
            bindings.bodies[declaration.patches]!.run(
              context(),
              parsed,
            ) as import("@pe/agent-contracts").WorkWrite["patches"];
          preview = freezePage(patches());
          send = () => {
            const observation = work.write(patches, invocation, invocation.id);
            observation.subscribe(
              () => notify(),
              () => {},
            );
            return observation;
          };
        } else if (declaration.kind === "command") {
          const entry = bindings.entries[declaration.entry]!;
          const intent = entry.input.parse(
            bindings.bodies[declaration.intent]!.run(context(), parsed),
          ) as Record<string, unknown>;
          preview = freezePage({ work: owner.read()!.work, input: intent });
          // ActionJournal owns the existing Reject? consent window after this admission.
          send = () => {
            if (!door) throw Error("Native commands unavailable");
            return (
              fixture === null
                ? (command: Parameters<NonNullable<KernelServices["submitNative"]>>[0]) =>
                    services.submitNative
                      ? services.submitNative(command)
                      : (services.nativeWrite ?? door).submit(command)
                : (command: Parameters<NonNullable<KernelServices["submitNative"]>>[0]) =>
                    door.submit(command)
            )({
              id: invocation.id,
              key: declaration.entry,
              target: target ?? { kind: "host" },
              input: intent,
            });
          };
        } else if (declaration.kind === "page") {
          const patch = bindings.bodies[declaration.patch]!.run(context(), parsed);
          preview = patch;
          send = () =>
            owner.acceptPage(invocation, patch as Parameters<typeof owner.acceptPage>[1]);
        } else throw Error("Query verb composition unavailable");
        const dispatch = () => {
          if (!owner.current(invocation)) throw Error("Review is stale; prepare it again");
          return send();
        };
        if (declaration.review === "shown") {
          reviews.set(id, { invocation, preview, send: dispatch });
          notify();
          return { kind: "review", preview };
        }
        return dispatch();
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
        listeners.clear();
      };
      try {
        transport = createAdmittedAddress({
          route,
          registry,
          owner,
          policy,
          address,
          memory,
          origin: { kind: "restore", source: "url", token: issuer.restore("url") },
        });
        if (transport.initial.kind === "refused") throw Error(transport.initial.message);
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
        invoke,
        review: (id: string) => {
          const review = reviews.get(id);
          return review
            ? { preview: review.preview, stale: !owner.current(review.invocation) }
            : null;
        },
        confirm: (id: string) => {
          const review = reviews.get(id);
          if (!review) throw Error("No review to confirm");
          const result = review.send();
          reviews.delete(id);
          notify();
          return result;
        },
        work: () => owner.read()?.work ?? null,
        workProblem: work.problem,
        refreshable: Object.values(route.data.readings).some(
          (reading) => reading.refresh === "explicit",
        ),
        restore: () => transport!.restore(),
        refresh(id?: string) {
          resolve();
          if (id !== undefined && !Object.hasOwn(route.data.readings, id))
            throw Error(`Unknown reading: ${id}`);
          if (id !== undefined) {
            const declaration = route.data.readings[id]!;
            if (declaration.kind === "use" && declaration.geometry) {
              geometry.refresh(id);
              return;
            }
          } else {
            for (const [key, declaration] of Object.entries(route.data.readings))
              if (declaration.kind === "use" && declaration.geometry?.representation === "overview")
                geometry.refresh(key);
          }
          const refresh = (key: string) => {
            demanded.add(key);
            generations.set(key, (generations.get(key) ?? 0) + 1);
            retire(key);
            for (const dependency of route.data.readings[key]!.deps.readings) refresh(dependency);
          };
          if (id === undefined) for (const key of Array.from(active.keys())) refresh(key);
          else refresh(id);
          schedule();
        },
        read(pane: string) {
          const current = resolve();
          if (!Object.hasOwn(route.data.panes, pane)) throw Error(`Unknown pane: ${pane}`);
          const declaration = route.data.panes[pane]!;
          if (!declaration.body) return null;
          return current.bodies[declaration.body]!.run({
            page: ports.page,
            work: owner.read()!.work?.value ?? null,
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
              ("allowed" in declaration.verbs ? declaration.verbs.allowed : declaration.verbs).map(
                (id: string) => [id, (input: unknown) => invoke(id, input)],
              ),
            ),
          });
        },
        close,
      };
    },
  };
}
export type AdmittedMount = ReturnType<ReturnType<typeof createRouteShell>["mount"]>;
