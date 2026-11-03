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
      // U8 is the read-only composition; U11/U12 extend this same door.
      if (
        route.data.capabilities.length ||
        route.data.work ||
        Object.keys(route.data.verbs).length
      ) {
        registration.deactivate();
        throw Error(
          "Admitted mount currently supports read-only declarations without capabilities",
        );
      }
      const policy = createPagePolicy(route.data, bindings.schemas, () => "unresolved");
      const initial = policy.initial();
      if (!initial.ok) {
        registration.deactivate();
        throw Error(initial.reason);
      }
      const issuer = createRouteTokenIssuer();
      const owner = createRouteScopeGate({
        dependencies: () => ({}),
        preparePage: policy.prepare,
        issuer,
      });
      owner.enter({ target: null, work: null }, initial.value);
      const ports = createPagePorts(route.data, { ...owner, readPage: () => owner.read()!.page });
      const environmentIssuer = createRouteEnvironmentIssuer();
      const plan = createAdmittedReadingPlan({
        route,
        issuer: environmentIssuer,
        key: {
          processIncarnation: "application",
          documentLifetime: "none",
          freshnessGeneration: 0,
        },
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
              createRouteEnvironment({ issuer: environmentIssuer, validate, ports: services }),
            fixture: (name) =>
              createNamedFixtureRouteEnvironment({
                issuer: environmentIssuer,
                validate,
                plan,
                name,
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
            const used = new Set<string>();
            const next: typeof readings = {};
            for (const id of Object.keys(route.data.readings)) {
              const declaration = route.data.readings[id]!;
              if (
                (declaration.demand === "explicit" && !demanded.has(id)) ||
                (declaration.demand === "subject" && owner.read()!.page[subjectField] === null)
              ) {
                next[id] = {
                  status: "unavailable",
                  current: false,
                  reason: "Explicit demand required",
                };
                continue;
              }
              next[id] = plan.read(id, { page: owner.read()!.page, work: null }, (request) => {
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
                    if (closed || active.get(readingId) !== record || !owner.current(record.token))
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
              });
            }
            for (const id of active.keys()) if (!used.has(id)) retire(id);
            readings = Object.freeze(next);
          } while (again && !closed);
        } finally {
          scheduling = false;
        }
        notify();
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
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        revision: () => revision,
        restore: () => transport!.restore(),
        refresh(id?: string) {
          resolve();
          if (id !== undefined && !Object.hasOwn(route.data.readings, id))
            throw Error(`Unknown reading: ${id}`);
          if (id !== undefined) demanded.add(id);
          for (const key of active.keys()) if (id === undefined || key === id) retire(key);
          schedule();
        },
        read(pane: string) {
          const current = resolve();
          if (!Object.hasOwn(route.data.panes, pane)) throw Error(`Unknown pane: ${pane}`);
          const declaration = route.data.panes[pane]!;
          if (!declaration.body) return null;
          return current.bodies[declaration.body]!.run({
            page: ports.page,
            work: null,
            readings: Object.freeze(
              Object.fromEntries(declaration.draws.map((id) => [id, readings[id]])),
            ),
            visible: true,
            verbs: {},
          });
        },
        close,
      };
    },
  };
}
export type AdmittedMount = ReturnType<ReturnType<typeof createRouteShell>["mount"]>;
