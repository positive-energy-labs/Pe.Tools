import { applyPatches, type WorkHandle } from "@pe/agent-contracts";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import {
  canonicalEnvironmentInput,
  type ReadHandle,
  type ResolvedReadKey,
} from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { InvocationToken } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { CommandResultDecode } from "./admitted-command-result.ts";
import type { MountContext } from "./admitted-context.ts";
import {
  createAdmittedReadingPlan,
  readingClosure,
  receiptHitsReading,
  type AdmittedReadingStatus,
} from "./admitted-reading-plan.ts";
import { freezePage } from "./page-port.ts";
import { contentHash } from "./readings.ts";
import { z } from "zod";
const unavailable = (reason: string): Extract<ReadingSnapshot<unknown>, { current: false }> => ({
  status: "unavailable",
  current: false,
  reason,
});
export type ReadingQuery = {
  input: unknown;
  landing?: string;
  phase: "pending" | "landed";
  inputsCurrent?: () => boolean;
  invocation: InvocationToken;
};
export function createAdmittedReadings<W extends Record<string, unknown>>(
  context: MountContext<W>,
) {
  const {
    route,
    owner,
    read,
    bindings,
    input,
    environmentIssuer,
    observers,
    cells,
    geometry,
    environment,
    schedule,
    notify,
    beforeSync,
    available,
    closed,
    entryFor,
    resolve,
    sourceTimeline,
  } = context;

  const { target } = input;
  type WorkReading =
    | (Extract<ReadingSnapshot<unknown>, { current: true }> & { readonly handle: WorkHandle })
    | Extract<ReadingSnapshot<unknown>, { current: false }>;
  // Bounded by declared edges. The environment owns the subscriptions' lifetime.
  type WorkRead = { signature: string; snapshot: WorkReading; stop(): void };
  const workReads = new Map<string, WorkRead>();
  const syncWorkReadings = () => {
    const scope = read().scope;
    const key = scope.identity.work;
    for (const [id, declaration] of Object.entries(route.data.readings)) {
      if (declaration.kind !== "work" || !key) continue;
      const foreignKey = { ...key, route: declaration.route };
      const signature = canonicalEnvironmentInput([scope.identity, foreignKey]);
      if (workReads.get(id)?.signature === signature) continue;
      workReads.get(id)?.stop();
      const record: WorkRead = {
        signature,
        snapshot: unavailable("Work pending"),
        stop() {},
      };
      workReads.set(id, record);
      const schema = bindings.schemas[declaration.output];
      if (!schema) throw Error(`Unlinked Work reading output: ${declaration.output}`);
      entryFor(foreignKey).connect(
        {
          route: route.data.key,
          fingerprint: route.workFingerprint,
          reading: id,
          key: foreignKey,
          target: scope.identity.target,
          subject: null,
        },
        environment().environment.work.read,
      );
      record.stop = environment()
        .environment.work.read.open({
          route: route.data.key,
          fingerprint: route.workFingerprint,
          reading: id,
          key: foreignKey,
          target: scope.identity.target,
          subject: null,
        })
        .subscribe(
          (state) => {
            if (workReads.get(id) !== record || closed()) return;
            let value: unknown;
            let handle: WorkHandle;
            if (state.kind === "ready") {
              const decoded = schema.safeParse(state.snapshot.value);
              if (!decoded.success) {
                record.snapshot = unavailable(
                  "Work could not be decoded. Refresh the pane to reconnect.",
                );
                schedule();
                return;
              }
              value = decoded.data;
              handle = state.snapshot.handle;
              entryFor(handle.key).restore(state);
            } else if (state.kind === "ack" && record.snapshot.current) {
              const ack = state.ack;
              if (ack.revision <= record.snapshot.handle.revision) return;
              const result = applyPatches(
                { route: declaration.route, title: "Work reading", description: "", schema },
                {
                  version: 1,
                  revision: record.snapshot.handle.revision,
                  doc: record.snapshot.value,
                },
                ack.by,
                ack.patches,
                ack.base,
                true,
                true,
              );
              if (!result.ok) {
                record.snapshot = unavailable(result.error);
                schedule();
                return;
              }
              value = result.envelope.doc;
              handle = { key: ack.key, revision: ack.revision };
              entryFor(handle.key).journal.accept(ack);
              entryFor(handle.key).journal.observe({ revision: handle.revision, doc: value });
            } else {
              record.snapshot = unavailable(
                state.kind === "failed" ? "Work feed failed" : "Work pending",
              );
              schedule();
              return;
            }
            if (record.snapshot.current && record.snapshot.handle.revision !== handle.revision)
              for (const key of invalidate(id))
                if (route.data.readings[key]?.refresh === "explicit") demanded.delete(key);
            record.snapshot = freezePage({
              status: "ready",
              current: true,
              value,
              handle,
              hash: z.string().parse(contentHash([handle.revision, value])),
            });
            schedule();
          },
          () => {
            if (workReads.get(id) !== record || closed()) return;
            record.snapshot = unavailable("Work feed ended");
            schedule();
          },
        );
    }
  };
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
    key: import("../../../../packages/agent-contracts/src/route-kernel-environment.ts").ResolvedReadKey;
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
  const evidence = context.sourceEvidence;
  const invalidate = (id: string) => {
    const stale = new Set([id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [key, reading] of Object.entries(route.data.readings))
        if (!stale.has(key) && reading.deps.readings.some((dep) => stale.has(dep))) {
          stale.add(key);
          changed = true;
        }
    }
    // A declared reading dependency is part of each dependent's freshness, even when its args
    // omit the value (ducts.sheet reads ducts Work host-side): re-key the whole closure.
    for (const key of stale) {
      generations.set(key, (generations.get(key) ?? 0) + 1);
      retire(key);
      retained.delete(key);
      geometry().invalidate(key);
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
    return stale;
  };
  function observeReceipts() {
    const key = owner.read()?.scope.identity.work;
    if (!key) return;
    const entry = entryFor(key);
    const receipts = entry.activity();
    const ids = new Set(receipts.map((receipt) => receipt.id));
    // Once the host owns this press, a bounded receipt snapshot cannot resurrect its local start.
    const starts = sourceTimeline.get(entry);
    if (starts)
      sourceTimeline.set(
        entry,
        starts.filter((start) => !ids.has(start.press ?? "")),
      );
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
    request: import("../../../../packages/agent-contracts/src/route-kernel-environment.ts").ResolvedRead<unknown>,
    record: Active,
  ) => {
    return evidence.observe?.(request, record.token, (event) => {
      if (closed() || active.get(readingId) !== record) return;
      if (event.kind === "log") {
        context.history().logEvidence(readingId, event.value);
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
    });
  };
  const pickerOptions: Record<string, unknown> = {};
  const demanded = new Set<string>();
  // Invocation arguments belong to the attempt, never to Page or selection.
  const queryInputs = new Map<string, ReadingQuery>();
  const queryLandings = new Map<string, CommandResultDecode>();
  const subjectField = route.data.subject.field;
  let evidenceScope = read().scope;
  let explicitWorkRevision: number | undefined;
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
        resolve();
        context.work().sync();
        syncWorkReadings();
        const revision = read().work?.revision;
        if (explicitWorkRevision !== undefined && explicitWorkRevision !== revision)
          for (const [id, declaration] of Object.entries(route.data.readings))
            if (declaration.refresh === "explicit" && declaration.deps.work.length)
              demanded.delete(id);
        explicitWorkRevision = revision;
        context.history().sync();
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
            next[id] = unavailable("Explicit demand required");
            continue;
          }
          if (!wanted.has(id)) {
            next[id] = readings[id] ?? unavailable("Pane hidden");
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
              workReadings: Object.fromEntries(
                [...workReads].map(([id, read]) => [id, read.snapshot]),
              ),
            },
            (request) => {
              const readingId = plan.readingId(request)!;
              if (route.data.readings[readingId]!.demand === "explicit" && !demanded.has(readingId))
                return unavailable("Explicit demand required");
              used.add(readingId);
              const signature = canonicalEnvironmentInput(request.key);
              dependencies.set(
                readingId,
                evidence.dependencies?.(request, owner.capture(`dependencies:${readingId}`)) ??
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
                    : {
                        status: "failed",
                        current: false,
                        reason: "This reading could not be decoded. Refresh the pane to try again.",
                      };
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
            query.phase === "landed" ||
            !result?.current ||
            result.status !== "ready" ||
            !owner.current(query.invocation.token)
          )
            continue;
          const declaration = route.data.readings[readingId]!;
          if (declaration.kind === "derive" || declaration.kind === "work") continue;
          const value =
            declaration.kind === "use" && declaration.geometry
              ? (result.value as { kind: string; value?: unknown }).value
              : result.value;
          // Source acceptance (or geometry acceptance) already decoded this exact value.
          query.phase = "landed";
          queryLandings.set(readingId, { kind: "decoded", value });
          // A current read publishes Page against the accepted state at completion.
          // Its original Work revision remains unchanged for query patch writes.
          const landing = owner.invocation(query.invocation.token, {});
          if (!landing.ok) continue;
          const patch = bindings.bodies[query.landing]!.run(freezePage(value), read().page);
          owner.acceptPage(landing.value, patch as Parameters<typeof owner.acceptPage>[1]);
        }
        for (const [key, field] of Object.entries(route.data.fields)) {
          if (field.role === "subject")
            pickerOptions[key] = freezePage(
              bindings.bodies[field.picker.options]!.run(readings[field.picker.reading]),
            );
        }
        context.invocation().sync();
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
    workHandles: (ids: readonly string[]) =>
      Object.fromEntries(
        ids.flatMap((id) => {
          const record = workReads.get(id);
          return record?.snapshot.current
            ? [[record.snapshot.handle.key.route, record.snapshot.handle]]
            : [];
        }),
      ),
    plan,
    beginQuery(id: string, query: Omit<ReadingQuery, "phase">, refreshGeometry = true) {
      const previous = queryInputs.get(id);
      if (previous) owner.retire(previous.invocation.token);
      queryLandings.delete(id);
      queryInputs.set(id, { ...query, phase: "pending" });
      demanded.add(id);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      retire(id);
      const reading = route.data.readings[id];
      if (refreshGeometry && reading?.kind === "use" && reading.geometry) geometry().refresh(id);
      else schedule();
    },
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
      for (const read of workReads.values()) read.stop();
      workReads.clear();
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
          snapshot: readings[id] ?? unavailable("Not read"),
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
