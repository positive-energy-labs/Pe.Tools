import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import {
  canonicalEnvironmentInput,
  type KernelServices,
  type ReadHandle,
  type ResolvedReadKey,
  type RouteEnvironmentIssuer,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { createAdmittedCells } from "./admitted-cells.ts";
import type { CommandResultDecode } from "./admitted-command-result.ts";
import type {
  MountedBindings,
  MountedOwner,
  MountedRoute,
  MountedSnapshot,
} from "./admitted-context.ts";
import type { createAdmittedGeometry } from "./admitted-geometry.ts";
import type { createAdmittedObservers } from "./admitted-observers.ts";
import type { PlaceInput } from "./admitted-place.ts";
import {
  createAdmittedReadingPlan,
  readingClosure,
  receiptHitsReading,
  type AdmittedReadingStatus,
} from "./admitted-reading-plan.ts";
import type { createApplicationWorkRegistry } from "./application-work-registry.ts";
import { freezePage } from "./page-port.ts";
import type { createRouteEnvironment } from "./route-environment.ts";
import { sourceReadingEvidence } from "./source-route-services.ts";
export function createAdmittedReadings<W extends Record<string, unknown>>({
  route,
  owner,
  read,
  bindings,
  input,
  services,
  environmentIssuer,
  observers,
  cells,
  geometry,
  environment,
  schedule,
  notify,
  settle,
  syncInvocation,
  beforeSync,
  available,
  closed,
  entryFor,
  logEvidence,
  resolve,
}: {
  route: MountedRoute<W>;
  owner: MountedOwner<W>;
  read(): MountedSnapshot<W>;
  bindings: MountedBindings;
  input: PlaceInput;
  services: Omit<KernelServices, "target">;
  environmentIssuer: RouteEnvironmentIssuer;
  observers: ReturnType<typeof createAdmittedObservers>;
  cells: ReturnType<typeof createAdmittedCells>;
  geometry(): ReturnType<typeof createAdmittedGeometry>;
  environment(): ReturnType<typeof createRouteEnvironment>;
  schedule(): void;
  notify(): void;
  settle(): void;
  syncInvocation(): void;
  beforeSync(): void;
  available(): boolean;
  closed(): boolean;
  entryFor(
    key: import("@pe/agent-contracts").WorkKey,
  ): ReturnType<ReturnType<typeof createApplicationWorkRegistry>["acquire"]>["entry"];
  logEvidence(id: string, value: unknown): void;
  resolve(): unknown;
}) {
  const { fixture, target } = input;
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
  let readings: Record<string, ReadingSnapshot<unknown>> = {};
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
    geometry().invalidate(id);
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
          if (closed() || active.get(readingId) !== record) return;
          if (event.kind === "log") {
            logEvidence(readingId, event.value);
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
  let scheduling = false;
  let again = false;
  const sync = () => {
    beforeSync();
    if (!available()) return;
    if (scheduling) {
      again = true;
      return;
    }
    scheduling = true;
    try {
      do {
        again = false;
        settle();
        if (evidenceScope !== read().scope) {
          evidenceScope = read().scope;
          for (const [id, reading] of Object.entries(route.data.readings))
            if (reading.retain.evidence === "scope") {
              retire(id);
              retained.delete(id);
              previous.delete(id);
            }
        }
        geometry().syncSubject();
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
          geometry().cancel(id);
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
            geometry().suspend(id);
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
              if (route.data.readings[readingId]!.demand === "explicit" && !demanded.has(readingId))
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
                record.handle = environment().environment.reads.acquire(request, record.token);
                const accept = (snapshot: ReadingSnapshot<unknown>) => {
                  if (closed() || active.get(readingId) !== record || !owner.current(record.token))
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
                const stopReading = environment().environment.readings.subscribe(
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
            geometry().read,
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
          const patch = bindings.bodies[query.landing]!.run(freezePage(decoded.data), read().page);
          owner.acceptPage(landing.value, patch as Parameters<typeof owner.acceptPage>[1]);
        }
        for (const [key, field] of Object.entries(route.data.fields)) {
          if (field.role === "subject")
            pickerOptions[key] = freezePage(
              bindings.bodies[field.picker.options]!.run(readings[field.picker.reading]),
            );
        }
        syncInvocation();
      } while (again && !closed());
    } finally {
      scheduling = false;
    }
    notify();
  };
  const refreshReadings = (roots: Iterable<string>) => {
    for (const id of readingClosure(route, roots)) {
      demanded.add(id);
      invalidate(id);
      if (route.data.readings[id]?.kind === "use" && route.data.readings[id]?.geometry)
        geometry().refresh(id, false);
    }
    schedule();
  };

  return {
    sync,
    snapshots: () => readings,
    plan,
    queryInputs,
    queryLandings,
    demanded,
    generations,
    retire,
    observeReceipts,
    ownsKey: (key: ResolvedReadKey) =>
      Array.from(active.values()).some((read) => read.handle?.key === key || read.key === key),
    demand: (id: string) => {
      demanded.add(id);
      schedule();
    },
    suspend() {
      for (const id of active.keys()) retire(id);
      for (const id of Object.keys(route.data.readings)) geometry().suspend(id);
    },
    picker: (field: string) => pickerOptions[field],
    public: {
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
          leased: !!active.get(id)?.handle || geometry().leased(id),
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
    },
  };
}
