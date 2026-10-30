import { z } from "zod";
import { graphSettings, type SettingsOwner } from "./settings";
import {
  canonicalRouteInput,
  commands,
  SALVAGE_VERB,
  salvageVerb,
  START_FRESH_VERB,
  startFreshVerb,
  validateRouteGraph,
  workKey,
  type ActionReceipt,
  type DocumentRef,
  type ExecutionTarget,
  type FieldDecl,
  type FieldRole,
  type RouteGraph,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type WorkHandle,
  type WorkKey,
  type WorkWrite,
  type VerbDecl,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { createViewOwner } from "../route/view-owner";
import { causeRefusal, refuse, writeRefusal } from "../route/refusal";
import {
  createReadingGraph,
  type ReadingLog,
  type ReadingAttempt,
  type ReadingSource,
  type ReadingState,
} from "./readings";
import type { WorkJournal } from "./journal";
import { acquireWorkWriter, type WorkWriter } from "./work-writes";
import { createRouteTimeline, type TimelineEntry } from "./timeline";
import { validateGraphChords } from "./keys";
import { kernelCellVerbs } from "./verbs-cells";
import {
  bind,
  commit,
  invoke,
  recoveryOffered,
  recoveryVerb,
  type WorkHistory,
  type InvocationResult,
  type ReviewTicket,
  type VerbContext,
  type VerbSubject,
  type PendingWorkHistory,
} from "./verbs";

export const graphFields = <P, W>(graph: RouteGraph<P, W>) =>
  Object.entries(graph.fields) as [keyof P & string, FieldDecl & { role: FieldRole }][];

export interface MountScope<W> {
  /** Resolved before hydration, so first Work delivery does not reacquire document readings. */
  workKey?: WorkKey;
  failure?: string | null;
  closed?: boolean;
  target: ExecutionTarget;
  work: { handle: WorkHandle; doc: W } | null;
  /** The mount sets this: a write was refused as stale and nothing newer has been read or accepted since. */
  conflict?: boolean;
  /** The kernel door sets this: the host holds Work it cannot read, so start-fresh is the one way out. */
  unreadable?: WorkKey;
  /** The kernel door sets this: what the host set aside for this Work, raw; the owner derives the patches with the readings. */
  salvaged?: unknown;
}
export const CONFLICT_REFUSAL = "Work changed; review and retry";
// One executable recovery for every mount; its declaration is the contract's, so Pea reads the same verb.
const { kind: _kind, review: _review, ...freshDeclaration } = startFreshVerb;
const startFresh = recoveryVerb("start-fresh", freshDeclaration);
const { kind: _salvageKind, review: _salvageReview, ...salvageDeclaration } = salvageVerb;
const salvage = recoveryVerb("salvage", salvageDeclaration);
export interface MountBinding {
  subject: VerbSubject | null;
  args: unknown;
}
/** What a verb binding may read: target, Work, Page and the current kernel reading states, one snapshot per call. */
export type BindingScope<P, W> = MountScope<W> & {
  page: P;
  readings: Readonly<Record<string, ReadingState>>;
};

export interface MountAdapters<P, W> {
  fixture?: { name: string; queries: Readonly<Record<string, unknown>>; select?(page: P): void };
  settings?: SettingsOwner;
  /**
   * Immutable external-store snapshot; Page is owned by the mount's existing ViewOwner. This and
   * the three host ports below come from the kernel's `useWorkScope`; only tests inject fakes.
   */
  getSnapshot(): MountScope<W>;
  subscribe(notify: () => void): () => void;
  sources: Readonly<Record<string, ReadingSource>>;
  initialPage?: Partial<P>;
  /** Derived history for all human writes, including composer and chat-head edits of this Work. */
  workHistory?: WorkHistory<{ request: WorkWrite; label: string }>;
  write(key: WorkKey, write: WorkWrite): Promise<RouteStateWriteResult>;
  subscribeAcceptedDeltas(key: WorkKey, onAck: (ack: WorkWriteAck) => void): () => void;
  /** The recovery door behind the start-fresh verb (`useWorkScope`); absent only in tests that never reach unreadable Work. */
  startFresh?(key: WorkKey): Promise<RouteStateWriteResult>;
  /** Asks the host for this Work again (the conflict banner's one control); absent in tests that never conflict. */
  reread?(key: WorkKey): void;
  subjects?: VerbContext["subjects"];
  binding?(id: string, row: unknown, scope: BindingScope<P, W>): MountBinding;
  /** The cell subject (`cell:<seg|key>`) a pane row stands for, or null; the kernel's cell verbs follow it. */
  cell?(row: unknown, scope: BindingScope<P, W>): VerbSubject | null;
  /** Explicit captures only. Ordinary pane demand must not start an expensive operation. */
  verbReadings?: Readonly<Record<string, readonly string[]>>;
  /**
   * Readings whose change stales a verb's bound basis and its ticket. Distinct from `verbReadings`
   * (captures the verb itself starts): a started capture changes version by the verb's own doing
   * and never counts against it. Work revision and the Page epoch are always in the basis.
   */
  verbDepends?: Readonly<Record<string, readonly string[]>>;
  /** Native effects name their actual Work footprint; [[]] explicitly means the whole Work. */
  receiptPaths?(receipt: ActionReceipt, key: WorkKey): readonly RouteStatePatch["path"][];
  subscribeReceipts?(
    accept: (receipt: ActionReceipt, key: WorkKey | null, press?: string) => void,
  ): () => void;
  subscribeDocumentChanged?(accept: (ref: DocumentRef) => void): () => void;
  logReading?(entry: ReadingLog): void;
  /** The storage owner returns a fact only after the immutable checkpoint is filed. */
  checkpoint?(snapshot: {
    scope: MountScope<W>;
    page: P;
    readings: unknown;
  }): Promise<Omit<TimelineEntry, "kind">>;
  navigate?(pane: string | null, everywhere: boolean): void;
}

export function mountRefusals<P, W>(
  graph: RouteGraph<P, W>,
  adapters?: Pick<MountAdapters<P, W>, "sources" | "verbReadings" | "verbDepends">,
) {
  const refusals = validateRouteGraph(graph);
  // validateRouteGraph also handles malformed runtime inputs; do not traverse those again.
  if (refusals.some((r) => r.code === "invalid-graph")) return refusals;
  const all = [...refusals, ...validateGraphChords(graph)];
  const invalid = (path: string, message: string) =>
    all.push({ code: "invalid-graph", path, message });
  if (!Object.keys(graph.stages).length) invalid("stages", "A route needs at least one stage");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (id === "page" && !graph.readings.page) return;
    if (visiting.has(id)) {
      invalid(`readings.${id}`, "Reading dependency cycle");
      return;
    }
    if (visited.has(id)) return;
    const reading = graph.readings[id];
    if (!reading) {
      all.push({
        code: "missing-reading",
        path: `readings.${id}`,
        message: `Unknown reading '${id}'`,
      });
      return;
    }
    visiting.add(id);
    if (adapters && adapters.sources[reading.source]?.kind !== reading.kind)
      invalid(`readings.${id}.source`, `Unresolved ${reading.kind} source '${reading.source}'`);
    for (const dep of reading.deps ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(graph.readings)) visit(id);
  for (const [verb, readings] of Object.entries(adapters?.verbReadings ?? {})) {
    if (!graph.verbs[verb]) invalid(`verbReadings.${verb}`, `Unknown verb '${verb}'`);
    for (const id of readings)
      if (!graph.readings[id]) invalid(`verbReadings.${verb}`, `Unknown reading '${id}'`);
  }
  for (const [verb, readings] of Object.entries(adapters?.verbDepends ?? {})) {
    if (!graph.verbs[verb]) invalid(`verbDepends.${verb}`, `Unknown verb '${verb}'`);
    for (const id of readings)
      if (!graph.readings[id]) invalid(`verbDepends.${verb}`, `Unknown reading '${id}'`);
  }
  return all;
}

/** Pure owners plus injected transport. React mounts demand, never owns write history. */
export function createGraphMount<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  initial: Partial<P> = {},
) {
  const refusals = mountRefusals(graph, adapters);
  if (refusals.length) throw new Error(refusals.map((r) => `${r.path}: ${r.message}`).join("\n"));
  const schema = z.object(
    Object.fromEntries(
      graphFields(graph)
        .filter(([, f]) => f.role !== "setting")
        .map(([id, f]) => [id, f.schema]),
    ),
  ) as z.ZodType<P>;
  const parsedPage = schema.parse({ ...adapters.initialPage, ...initial });
  const normalized = graph.transition?.(parsedPage, parsedPage, "initial", { readings: {} });
  if (normalized && "refusal" in normalized) throw Error(normalized.refusal.message);
  const initialPage = schema.parse({ ...parsedPage, ...normalized?.patch });
  const settings = adapters.settings ?? graphSettings(graph);
  // Validation ran above: cell verb ids cannot collide with graph verbs, so a plain spread is safe.
  const kernel = kernelCellVerbs(graph);
  const verbs: Readonly<Record<string, VerbDecl>> = {
    ...graph.verbs,
    ...kernel.verbs,
    ...(graph.work && { [START_FRESH_VERB]: startFresh }),
    ...(graph.work && graph.salvage && { [SALVAGE_VERB]: salvage }),
  };
  const registry = makeAtomRegistry();
  const base = createRouteOwner(graph.key, registry);
  let readings: ReturnType<typeof createReadingGraph<P, W>>;
  const view = createViewOwner(base, schema, initialPage, {
    transition:
      graph.transition &&
      ((current, patch, origin) =>
        graph.transition!(current, patch, origin, {
          readings: readings
            ? Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)]))
            : {},
        })),
  });
  adapters.fixture?.select?.(initialPage);
  let raw = adapters.getSnapshot();
  let scope = raw;
  // One count per Target/Work-key change: a verb's result is admitted only into the generation it started in.
  let generation = 0;
  let scopeId = canonicalRouteInput([
    raw.target,
    raw.workKey ? workKey(raw.workKey) : raw.work ? workKey(raw.work.handle.key) : null,
  ]);
  // One Work per mount at a time: the stale write's key and the revision it was refused against.
  let conflict: { work: string; revision: number } | null = null;
  let rejected: { key: WorkKey; request: WorkWrite; verb: string; input: MountBinding } | null =
    null;
  let invoking: { verb: string; input: MountBinding } | null = null;
  let disposed = false;
  let available = () => true;
  let journalRefusal: string | null = null;
  let serial = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    if (!disposed) {
      serial++;
      for (const listener of listeners) listener();
    }
  };
  const timeline = createRouteTimeline();
  const journals = new Map<string, WorkJournal>();
  const writers = new Map<string, WorkWriter>();
  const releaseJournals: (() => void)[] = [];
  const deltas = new Map<string, () => void>();
  const dispatches = new Map<
    string,
    {
      key: WorkKey | null;
      verb: string;
      input: MountBinding | null;
      readings: readonly string[];
      attempts: Map<string, ReadingAttempt>;
      origin: string;
    }
  >();
  const reviews = new Map<string, { verb: string; ticket: ReviewTicket; origin: string }>();
  const paneRows = new Map<string, unknown>();
  const results = new Map<string, InvocationResult>();
  const unsettledWorks = new Map<string, WorkKey | null>();
  const sequenceReceipts = new Map<string, ActionReceipt[]>();
  let active: string | null = null;
  let activeOrigin = "";
  let connected = false;
  let releases: (() => void)[] = [];
  const readScope = () => ({
    target: scope.target,
    workKey: scope.workKey ?? scope.work?.handle.key ?? null,
    workRevision: scope.work?.handle.revision ?? null,
    work: scope.work?.doc ?? null,
    page: view.read().page,
    settings: settings.read().values,
  });
  // Page is a built-in graph input, not a host reading or a second writable Page.
  const needsPage =
    !graph.readings.page && Object.values(graph.readings).some((r) => r.deps?.includes("page"));
  try {
    readings = createReadingGraph(
      {
        readings: {
          ...graph.readings,
          ...(needsPage
            ? {
                page: {
                  kind: "derive" as const,
                  source: "@shell/page",
                  retire: "page" as const,
                  args: (p: Readonly<P>) => p,
                },
              }
            : {}),
        },
      },
      {
        sources: {
          ...adapters.sources,
          ...(needsPage
            ? {
                "@shell/page": {
                  kind: "derive" as const,
                  derive: (ctx: { page: unknown }) => ctx.page,
                },
              }
            : {}),
        },
        scope: readScope(),
        log: (entry) => {
          adapters.logReading?.(entry);
          if (entry.kind === "feed")
            timeline.append({
              kind: "feed",
              at: Date.now(),
              verb: entry.reading,
              subject: entry.value,
              basis: { workKey: entry.attempt.workKey ? workKey(entry.attempt.workKey) : null },
            });
        },
      },
    );
  } catch (cause) {
    view.dispose();
    base.dispose();
    registry.dispose();
    throw cause;
  }
  /** The route says what the set-aside Work still adds; a throwing hook offers nothing. */
  const salvagePatches = (): readonly RouteStatePatch[] | null => {
    if (!graph.salvage || !("salvaged" in scope)) return null;
    try {
      const patches = graph.salvage(scope.salvaged, scope.work?.doc ?? null, {
        readings: Object.fromEntries(
          Object.keys(graph.readings).map((id) => [id, readings.get(id)]),
        ),
      });
      return patches.length ? patches : null;
    } catch {
      return null;
    }
  };
  const basisFor = (ids: readonly string[]) =>
    Object.fromEntries(
      ids.map((id) => {
        const state = readings.get(id);
        return [id, { version: state.version, current: state.current, basis: state.basis }];
      }),
    );
  const basis = () =>
    Object.fromEntries(
      Object.keys(graph.readings).map((id) => {
        const state = readings.get(id);
        return [id, { version: state.version, current: state.current, basis: state.basis }];
      }),
    );
  // Human and Pea reach the same flag: the host's stale refusal sets it, any accepted delta or a
  // newer read of the Work clears it.
  const present = () => {
    scope =
      conflict && raw.work && workKey(raw.work.handle.key) === conflict.work
        ? { ...raw, conflict: true }
        : raw;
  };
  const flag = (next: typeof conflict) => {
    const prior = conflict;
    if (prior?.work === next?.work && prior?.revision === next?.revision) return;
    conflict = next;
    present();
  };
  const journalFor = (key: WorkKey) => {
    const id = workKey(key);
    let journal = journals.get(id);
    if (!journal) {
      const acquired = acquireWorkWriter(key);
      const writer = acquired.writer;
      writers.set(id, writer);
      journal = writer.journal;
      releaseJournals.push(
        acquired.release,
        writer.describeWrites((request, label) => {
          const history = adapters.workHistory;
          if (
            !history ||
            !connected ||
            disposed ||
            !available() ||
            !scope.work ||
            workKey(scope.work.handle.key) !== id ||
            scope.work.handle.revision !== request.expectedRevision
          )
            return;
          const before = structuredClone({
            snapshot: context.snapshot(),
            page: view.read().page as Readonly<Record<string, unknown>>,
            subject: null,
            value: scope.work.doc,
            readings: Object.fromEntries(
              Object.keys(graph.readings).map((id) => [id, readings.get(id)]),
            ),
          });
          if (
            history.readings?.some(
              (id) =>
                !before.readings[id]?.current ||
                before.readings[id]?.basis?.workRevision !== request.expectedRevision,
            )
          )
            return;
          const input = { request, label };
          const pending: PendingWorkHistory = {
            entry: history.describe(before, input),
            readings: history.readings ?? [],
            complete: (after) => history.describe(before, input, after),
          };
          const started = generation;
          const epoch = view.read().epoch;
          return {
            entry: pending.entry,
            accepted: (ack) => {
              if (!disposed) recordHistory(key, ack, pending, started, epoch);
            },
          };
        }),
        writer.subscribe(() => {
          if (raw.work && workKey(raw.work.handle.key) === id)
            flag(writer.conflict() ? { work: id, revision: raw.work.handle.revision } : null);
          notify();
        }),
      );
      journals.set(id, journal);
      if (writer.conflict() && raw.work && workKey(raw.work.handle.key) === id)
        flag({ work: id, revision: raw.work.handle.revision });
    }
    if (connected && !disposed && !deltas.has(id))
      deltas.set(
        id,
        adapters.subscribeAcceptedDeltas(key, (ack) => {
          writers.get(id)!.accept(ack);
        }),
      );
    return journal;
  };
  if (scope.work) journalFor(scope.work.handle.key);
  const historyCompletions = new Map<
    string,
    {
      key: WorkKey;
      revision: number;
      generation: number;
      epoch: number;
      history: PendingWorkHistory;
    }
  >();
  const completeHistory = () => {
    for (const [press, pending] of historyCompletions) {
      if (
        pending.generation !== generation ||
        pending.epoch !== view.read().epoch ||
        (scope.work && scope.work.handle.revision > pending.revision)
      ) {
        historyCompletions.delete(press);
        continue;
      }
      if (!scope.work || scope.work.handle.revision !== pending.revision) continue;
      const after = Object.fromEntries(
        pending.history.readings.map((id) => [id, readings.get(id)]),
      );
      if (
        !Object.values(after).every(
          (state) =>
            state.current &&
            state.basis?.workRevision === pending.revision &&
            state.basis.attempt.workKey &&
            workKey(state.basis.attempt.workKey) === workKey(pending.key),
        )
      )
        continue;
      journalFor(pending.key).describe(press, pending.history.complete(after));
      historyCompletions.delete(press);
    }
  };
  const recordHistory = (
    key: WorkKey,
    ack: WorkWriteAck,
    history: PendingWorkHistory,
    started: number,
    epoch: number,
  ) => {
    if (!ack.press) return;
    journalFor(key).describe(ack.press, history.entry);
    journalRefusal = null;
    if (history.readings.length) {
      historyCompletions.set(ack.press, {
        key,
        revision: ack.revision,
        generation: started,
        epoch,
        history,
      });
      completeHistory();
    }
    notify();
  };
  const unTimeline = timeline.subscribe((entry) => {
    const key =
      entry.basis && typeof entry.basis === "object" && "workKey" in entry.basis
        ? entry.basis.workKey
        : null;
    if (typeof key === "string") journals.get(key)?.record(entry);
    notify();
  });
  const write = async (key: WorkKey, request: WorkWrite, history?: PendingWorkHistory) => {
    const started = generation;
    const epoch = view.read().epoch;
    const invocation = request.press ? dispatches.get(request.press) : undefined;
    journalFor(key);
    const result = await writers.get(workKey(key))!.write(
      scope,
      request,
      (key, request) => adapters.write(key, request),
      graph.cells,
      history && {
        entry: history.entry,
        accepted: (ack) => {
          if (!disposed) recordHistory(key, ack, history, started, epoch);
        },
      },
    );
    if (
      !disposed &&
      !result.ok &&
      "code" in result &&
      result.code === "stale_revision" &&
      invocation?.input
    )
      rejected = structuredClone({ key, request, verb: invocation.verb, input: invocation.input });
    notify();
    return result;
  };
  const acceptReceipt = (
    receipt: ActionReceipt,
    key: WorkKey | null,
    press?: string,
    invalidate = true,
  ) => {
    if (disposed) return;
    if (receipt.state === "waiting" || receipt.state === "running") return;
    key = unsettledWorks.has(receipt.id)
      ? unsettledWorks.get(receipt.id)!
      : press && dispatches.has(press)
        ? dispatches.get(press)!.key
        : key;
    unsettledWorks.delete(receipt.id);
    const declaration = commands[receipt.key as keyof typeof commands];
    if (invalidate) readings.acceptReceipt(receipt, declaration?.dirties ?? []);
    const identity = key ? workKey(key) : null;
    if (key) journalFor(key);
    const stamp = canonicalRouteInput([receipt.id, receipt.state, receipt.effects]);
    if (timeline.read().some((e) => e.receiptId === stamp)) return;
    timeline.append({
      kind: "receipt",
      at: Date.now(),
      receiptId: stamp,
      press,
      paths: key ? adapters.receiptPaths?.(receipt, key) : undefined,
      basis: { workKey: identity, receipt },
    });
  };
  const context: VerbContext<"human"> = {
    fixture: adapters.fixture,
    caller: "human",
    receipt: (receipt, press) => {
      acceptReceipt(receipt, dispatches.get(press)?.key ?? null, press, false);
      sequenceReceipts.set(press, [...(sequenceReceipts.get(press) ?? []), receipt]);
    },
    page: () => view.read().page as Record<string, unknown>,
    landReview: (page) => view.setPage(page as Partial<P>),
    readings: () =>
      Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)])),
    subjects: { ...adapters.subjects, ...kernel.subjects },
    snapshot: (verb) => ({
      failure: scope.failure,
      closed: scope.closed,
      target: scope.target,
      work: scope.work,
      unreadable: scope.unreadable ?? null,
      salvage: salvagePatches(),
      generation,
      basis: {
        pageEpoch: view.read().epoch,
        // Only the readings this verb declares; see VerbContext.snapshot.
        readings: verb ? basisFor(adapters.verbDepends?.[verb] ?? []) : basis(),
        unreadable: scope.unreadable ? workKey(scope.unreadable) : null,
        salvage: salvagePatches(),
      },
    }),
    write: (key, envelope, history) => write(key, { ...envelope, kind: "apply" }, history),
    recover: async (key) => {
      if (!adapters.startFresh)
        return { ok: false, kind: "refused", error: "This route has no recovery door", hint: "" };
      const result = await adapters.startFresh(key);
      if (result.ok && !disposed) {
        journalFor(key);
        writers.get(workKey(key))!.accept(result.write);
      }
      return result;
    },
    changed: () => notify(),
    owner: {
      runAction: (name, work, keys, stopped, label, wait) =>
        base.runAction(
          name,
          async (cancelWith, press) => {
            const id = active!;
            const key = scope.work ? structuredClone(scope.work.handle.key) : null;
            if (key) journalFor(key);
            const ids = adapters.verbReadings?.[id] ?? [];
            const attempts = new Map<string, ReadingAttempt>();
            dispatches.set(press, {
              key,
              verb: id,
              input: invoking?.verb === id ? structuredClone(invoking.input) : null,
              readings: ids,
              attempts,
              origin: activeOrigin,
            });
            timeline.append({
              kind: "invocation",
              at: Date.now(),
              press,
              verb: id,
              basis: { workKey: key ? workKey(key) : null },
            });
            for (const reading of ids)
              attempts.set(
                reading,
                readings.start(
                  reading,
                  press,
                  !(
                    verbs[id]?.kind === "query" &&
                    graph.readings[reading]?.query === verbs[id]?.does
                  ),
                ),
              );
            return work(cancelWith, press);
          },
          keys,
          stopped,
          label,
          wait,
        ),
    },
  };
  /**
   * The core sees one verb at a time; its snapshot basis is that verb's declared readings. One
   * context per verb for the owner's life: the core keys open reviews by context identity.
   */
  const contexts = new Map<string, VerbContext<"human">>();
  const ctxFor = (id: string): VerbContext<"human"> => {
    let own = contexts.get(id);
    if (!own) {
      own = { ...context, snapshot: () => context.snapshot(id) };
      contexts.set(id, own);
    }
    return own;
  };
  const consume = (id: string, result: InvocationResult) => {
    if (disposed) return result;
    results.set(id, result);
    if (result.state === "review")
      reviews.set(id, {
        verb: id,
        ticket: result.ticket,
        origin: dispatches.get(result.press)!.origin,
      });
    else {
      // Invalid required answers leave the authentic review open for correction.
      const review = reviews.get(id);
      if (
        review &&
        result.state === "refused" &&
        dispatches.has(review.ticket.press) &&
        registry.get(base.busy)
      ) {
        notify();
        return result;
      }
      reviews.delete(id);
      if (result.press) {
        const dispatch = dispatches.get(result.press);
        if (dispatch && "page" in result && result.page) view.setPage(result.page as Partial<P>);
        if (
          dispatch &&
          result.state === "done" &&
          (result.kind === "query" || result.kind === "rpc")
        ) {
          timeline.append({
            kind: "receipt",
            at: Date.now(),
            press: result.press,
            verb: id,
            receiptId: `query:${result.press}`,
            basis: { workKey: dispatch.key ? workKey(dispatch.key) : null, query: result.receipt },
          });
          // A read that names its subject Work selects it through Page, the one carry the door follows.
          for (const reading of dispatch.readings)
            if (graph.readings[reading]?.query === result.receipt.key)
              readings.publish(
                reading,
                result.press,
                dispatch.attempts.get(reading)!,
                result.receipt.value,
              );
          if (result.receipt.subject !== null && graph.workSubject)
            view.setPage({ [graph.workSubject]: result.receipt.subject } as Partial<P>);
        }
        if (
          dispatch &&
          result.state === "done" &&
          result.kind === "recovery" &&
          result.recovery === "start-fresh"
        )
          // The whole Work is replaced: a root barrier on the timeline, and the journal holds no step.
          timeline.append({
            kind: "receipt",
            at: Date.now(),
            press: result.press,
            verb: id,
            receiptId: `recovery:${result.press}`,
            paths: [[]],
            basis: { workKey: workKey(result.acknowledgement.key) },
          });
        if (dispatch) {
          // This press's own intermediate effects retire readings after the ordered reviews end.
          for (const receipt of sequenceReceipts.get(result.press) ?? [])
            readings.acceptReceipt(
              receipt,
              commands[receipt.key as keyof typeof commands]?.dirties ?? [],
            );
          sequenceReceipts.delete(result.press);
          if (
            "receipt" in result &&
            result.receipt &&
            !("kind" in result && (result.kind === "query" || result.kind === "rpc"))
          ) {
            if (["detached", "waiting", "running"].includes(result.receipt.state))
              unsettledWorks.set(result.receipt.id, dispatch.key);
            else if (result.receipt.state !== "detached")
              acceptReceipt(result.receipt, dispatch.key, result.press);
          }
          for (const reading of dispatch.readings) {
            if (graph.readings[reading]?.query === verbs[id]?.does && "refusal" in result)
              readings.fail(
                reading,
                result.press,
                dispatch.attempts.get(reading)!,
                result.refusal.message,
              );
            readings.finish(reading, result.press);
          }
          dispatches.delete(result.press);
        }
      }
    }
    notify();
    return result;
  };
  const bindingScope = (): BindingScope<P, W> => ({
    ...scope,
    page: view.read().page,
    readings: Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)])),
  });
  const cellSubject = (row: unknown): VerbSubject | null => {
    const subject = row === undefined ? null : (adapters.cell?.(row, bindingScope()) ?? null);
    if (subject && !kernel.placement[subject.type])
      throw Error(`Row resolved unknown cell type '${subject.type}'`);
    return subject;
  };
  const binding = (id: string, row?: unknown): MountBinding =>
    // Kernel-owned verbs (cells, recovery) take kernel args; a route's binding never sees them.
    kernel.verbs[id]
      ? { subject: cellSubject(row), args: {} }
      : verbs[id]?.kind === "recovery"
        ? { subject: null, args: {} }
        : (adapters.binding?.(id, row, bindingScope()) ?? {
            subject: null,
            args: {},
          });
  // Writing verbs wait out a conflict; queries only read, so they still run.
  /** A failed dependency names its failure; it never reads as "refreshing". */
  const failedDependency = (id: string) => {
    for (const reading of adapters.verbDepends?.[id] ?? []) {
      const state = readings.get(reading);
      if (state.status === "failed") return `${reading} failed: ${state.error ?? "unknown error"}`;
    }
    return null;
  };
  const blocked = (id: string) =>
    disposed || !available()
      ? "This route is inactive"
      : conflict && scope.conflict && verbs[id]?.effect !== "query"
        ? CONFLICT_REFUSAL
        : failedDependency(id);
  const retryRefusal = () => {
    if (!rejected) return "There is no unaccepted edit";
    if (scope.closed || scope.failure) return scope.failure ?? "This Work is closed";
    const inactive = blocked(rejected.verb);
    if (inactive) return inactive;
    if (registry.get(base.busy)) return "Wait for the running verb";
    const work = scope.work;
    if (!work || workKey(work.handle.key) !== workKey(rejected.key))
      return "Return to the Work that owns this edit";
    return work.handle.revision <= rejected.request.expectedRevision
      ? "Read current Work before retrying"
      : null;
  };
  const run = async (id: string, bound: MountBinding, origin: string, answers?: unknown) => {
    const inactive = blocked(id);
    if (inactive)
      return {
        state: "refused" as const,
        press: null,
        refusal: refuse("not-ready", inactive),
      };
    const verb = verbs[id];
    if (!verb) throw Error(`Unknown verb ${id}`);
    const review = reviews.get(id);
    // Another press cannot steal the running invocation's identity.
    active = id;
    activeOrigin = origin;
    invoking = { verb: id, input: structuredClone(bound) };
    const result = review
      ? await commit(ctxFor(id), verb, review.ticket, answers)
      : await invoke(ctxFor(id), verb, bound.subject, bound.args);
    return consume(id, result);
  };
  const cancelReviews = () => {
    for (const { verb, ticket } of reviews.values())
      void invoke(ctxFor(verb), verbs[verb]!, ticket.subject, ticket.input, {
        kind: "cancel",
        ticket,
      }).then((result) => consume(verb, result));
    reviews.clear();
  };
  const stage = () => {
    const entry = graphFields(graph).find(([, f]) => f.role === "stage");
    const value = entry ? view.read().page[entry[0] as keyof P] : undefined;
    return typeof value === "string" && graph.stages[value]
      ? value
      : (graph.stageOrder ?? Object.keys(graph.stages))[0]!;
  };
  return {
    registry,
    settings,
    fixture: adapters.fixture,
    view,
    readings,
    timeline,
    journals,
    results,
    reviews,
    context,
    busy: () => registry.get(base.busy),
    journalRefusal: () => journalRefusal,
    paneRows,
    /** Graph verbs plus the kernel's cell verbs; the one table every lookup reads. */
    verbs,
    /**
     * The verb ids the Situation draws: the stage's own, then each kernel recovery only while its
     * predicate holds (start-fresh on unreadable Work, carry-over on readable Work with a remainder).
     */
    stageVerbs(): readonly string[] {
      const own = graph.stages[stage()]!.verbs;
      const offered = [START_FRESH_VERB, SALVAGE_VERB].filter(
        (id) => verbs[id] && recoveryOffered(verbs[id], context.snapshot()),
      );
      return [...own, ...offered];
    },
    /** Reads the current Work again, which is what ends a conflict. */
    reread() {
      if (scope.work) adapters.reread?.(scope.work.handle.key);
    },
    rejected: () => rejected,
    retryRefusal,
    discard() {
      if (rejected?.request.press)
        writers.get(workKey(rejected.key))?.discard(rejected.request.press);
      rejected = null;
      notify();
    },
    async retry() {
      const edit = rejected;
      const work = scope.work;
      if (!edit || !work || retryRefusal()) return;
      active = edit.verb;
      activeOrigin = "retry";
      invoking = { verb: edit.verb, input: edit.input };
      await context.owner.runAction(edit.verb, async (_cancel, press) => {
        try {
          const result = await write(work.handle.key, {
            ...edit.request,
            expectedRevision: work.handle.revision,
            press,
          });
          if (result.ok) {
            if (edit.request.press) writers.get(workKey(edit.key))?.discard(edit.request.press);
            if (rejected === edit) rejected = null;
            consume(edit.verb, {
              state: "done",
              kind: "work",
              press,
              acknowledgement: result.write,
            });
            return null;
          }
          const refusal = writeRefusal(result)!;
          consume(edit.verb, { state: "refused", press, refusal });
          return refusal;
        } catch (cause) {
          const refusal = causeRefusal(cause);
          consume(edit.verb, { state: "failed", press, refusal });
          return refusal;
        }
      });
      notify();
    },
    /** Chord-free cell verb ids a row carries (palette and row menu only); [] when it is no cell. */
    cellVerbs: (row: unknown): readonly string[] => {
      const subject = cellSubject(row);
      return subject ? kernel.placement[subject.type]! : [];
    },
    focusRow(pane: string, row: unknown) {
      if (Object.is(paneRows.get(pane), row)) return;
      paneRows.set(pane, row);
      notify();
    },
    setAvailable(check: () => boolean) {
      available = check;
    },
    snapshot: () => scope,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => serial,
    binding,
    control(id: string, row?: unknown, place = "stage") {
      const bound = structuredClone(binding(id, row));
      // A control's identity is where it sits (place, row, subject), never its args: a binding
      // reads current readings and Work, so args change after a write while the review must stay
      // at its control for the core staleness check to run. Cross-row commits stay refused.
      const origin = canonicalRouteInput([place, row ?? null, bound.subject]);
      const control = bind(verbs[id]!, { ctx: ctxFor(id), ...bound });
      const reason = () =>
        blocked(id) ??
        (reviews.has(id)
          ? reviews.get(id)!.origin === origin
            ? null
            : "Finish this verb's review at its original control"
          : control.refusal);
      return {
        ...control,
        get refusal() {
          return reason();
        },
        get review() {
          const review = reviews.get(id);
          return review?.origin === origin ? review : undefined;
        },
        run: (answers?: unknown) => {
          const refusal = reason();
          return refusal
            ? Promise.resolve(
                consume(id, {
                  state: "refused",
                  press: null,
                  refusal: refuse("not-ready", refusal),
                }),
              )
            : run(id, bound, origin, answers);
        },
      };
    },
    stage,
    journal: journalFor,
    async restore(direction: "undo" | "redo", press?: string) {
      if (!scope.work || disposed || !available()) return null;
      const key = structuredClone(scope.work.handle.key);
      const result = await journalFor(key)[direction]((request) => write(key, request), press);
      journalRefusal = result.ok ? null : result.message;
      notify();
      return result;
    },
    stop() {
      for (const [press, dispatch] of dispatches)
        for (const reading of dispatch.readings) readings.cancel(reading, press);
      if (reviews.size) cancelReviews();
      else base.stop();
    },
    async checkpoint() {
      if (!adapters.checkpoint || disposed || !available()) return;
      const frozen = structuredClone({ scope, page: view.read().page, readings: basis() });
      const fact = await adapters.checkpoint(frozen);
      if (!disposed) timeline.append({ ...fact, kind: "checkpoint" });
    },
    connect() {
      if (connected || disposed) return () => {};
      connected = true;
      const update = () => {
        const previousTarget = raw.target;
        raw = adapters.getSnapshot();
        const seen = raw.work;
        const id = canonicalRouteInput([
          raw.target,
          raw.workKey ? workKey(raw.workKey) : seen ? workKey(seen.handle.key) : null,
        ]);
        if (id !== scopeId) {
          scopeId = id;
          generation++;
        }
        if (
          previousTarget.kind !== "host" &&
          canonicalRouteInput(previousTarget) !== canonicalRouteInput(raw.target)
        ) {
          cancelReviews();
          paneRows.clear();
          results.clear();
          present();
          const reset = Object.fromEntries(
            (graph.resetOnTarget ?? []).map((key) => [
              key,
              graph.fields[key].schema.parse(undefined),
            ]),
          );
          if (Object.keys(reset).length) view.setPage(reset as Partial<P>);
        }
        // A newer read of the Work is the re-read that ends a conflict.
        if (
          conflict &&
          (!seen ||
            workKey(seen.handle.key) !== conflict.work ||
            seen.handle.revision !== conflict.revision)
        )
          flag(null);
        else present();
        if (scope.work) {
          journalFor(scope.work.handle.key);
          writers.get(workKey(scope.work.handle.key))!.observe(scope);
        }
        readings.update(readScope());
        notify();
      };
      for (const journal of journals.values()) journalFor(journal.key);
      releases = [
        settings.connect(),
        settings.subscribe(() => {
          cancelReviews();
          readings.update(readScope());
          notify();
        }),
        adapters.subscribe(update),
        view.subscribe(() => {
          adapters.fixture?.select?.(view.read().page);
          readings.update(readScope());
          notify();
        }),
        ...Object.keys(graph.readings).map((id) =>
          readings.subscribe(id, () => {
            completeHistory();
            notify();
          }),
        ),
      ];
      if (adapters.subscribeDocumentChanged)
        releases.push(adapters.subscribeDocumentChanged((ref) => readings.documentChanged(ref)));
      if (adapters.subscribeReceipts) releases.push(adapters.subscribeReceipts(acceptReceipt));
      update();
      return () => {
        connected = false;
        for (const release of releases.splice(0).reverse()) release();
        for (const release of deltas.values()) release();
        deltas.clear();
      };
    },
    dispose() {
      if (disposed) return;
      cancelReviews();
      disposed = true;
      connected = false;
      for (const release of releases.splice(0).reverse()) release();
      for (const release of deltas.values()) release();
      deltas.clear();
      unTimeline();
      historyCompletions.clear();
      for (const release of releaseJournals.reverse()) release();
      readings.dispose();
      view.dispose();
      base.dispose();
      registry.dispose();
      listeners.clear();
    },
  };
}

export type GraphMount<P, W> = ReturnType<typeof createGraphMount<P, W>>;
