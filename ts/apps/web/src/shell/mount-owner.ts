import { z } from "zod";
import {
  canonicalRouteInput,
  commands,
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
import { createRouteOwner, makeAtomRegistry } from "../route/route-owner";
import { createViewOwner } from "../route/view-owner";
import { refuse } from "../route/refusal";
import { createReadingGraph, type ReadingLog, type ReadingSource } from "./readings";
import { createWorkJournal } from "./journal";
import { createRouteTimeline, type TimelineEntry } from "./timeline";
import { validateGraphChords } from "./keys";
import { kernelCellVerbs } from "./verbs-cells";
import {
  bind,
  commit,
  invoke,
  type InvocationResult,
  type ReviewTicket,
  type VerbContext,
  type VerbSubject,
} from "./verbs";

export const graphFields = <P, W>(graph: RouteGraph<P, W>) =>
  Object.entries(graph.fields) as [keyof P & string, FieldDecl & { role: FieldRole }][];

export interface MountScope<W> {
  target: ExecutionTarget;
  work: { handle: WorkHandle; doc: W } | null;
}
export interface MountBinding {
  subject: VerbSubject | null;
  args: unknown;
}
export interface MountAdapters<P, W> {
  /** Immutable external-store snapshot; Page is owned by the mount's existing ViewOwner. */
  getSnapshot(): MountScope<W>;
  subscribe(notify: () => void): () => void;
  sources: Readonly<Record<string, ReadingSource>>;
  initialPage?: Partial<P>;
  write(key: WorkKey, write: WorkWrite): Promise<RouteStateWriteResult>;
  subscribeAcceptedDeltas(key: WorkKey, onAck: (ack: WorkWriteAck) => void): () => void;
  subjects?: VerbContext["subjects"];
  binding?(id: string, row: unknown, scope: MountScope<W> & { page: P }): MountBinding;
  /** The cell subject (`cell:<seg|key>`) a pane row stands for, or null; the kernel's cell verbs follow it. */
  cell?(row: unknown, scope: MountScope<W> & { page: P }): VerbSubject | null;
  /** Explicit captures only. Ordinary pane demand must not start an expensive operation. */
  verbReadings?: Readonly<Record<string, readonly string[]>>;
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

export function mountRefusals<P, W>(graph: RouteGraph<P, W>, adapters?: MountAdapters<P, W>) {
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
    Object.fromEntries(graphFields(graph).map(([id, f]) => [id, f.schema])),
  ) as z.ZodType<P>;
  const initialPage = schema.parse({ ...adapters.initialPage, ...initial });
  // Validation ran above: cell verb ids cannot collide with graph verbs, so a plain spread is safe.
  const kernel = kernelCellVerbs(graph);
  const verbs: Readonly<Record<string, VerbDecl>> = { ...graph.verbs, ...kernel.verbs };
  const registry = makeAtomRegistry();
  const base = createRouteOwner(graph.key, registry);
  const view = createViewOwner(base, schema, initialPage, { transition: graph.transition });
  let scope = adapters.getSnapshot();
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
  const journals = new Map<string, ReturnType<typeof createWorkJournal>>();
  const deltas = new Map<string, () => void>();
  const dispatches = new Map<
    string,
    { key: WorkKey | null; verb: string; readings: readonly string[]; origin: string }
  >();
  const reviews = new Map<string, { verb: string; ticket: ReviewTicket; origin: string }>();
  const paneRows = new Map<string, unknown>();
  const results = new Map<string, InvocationResult>();
  const unsettledWorks = new Map<string, WorkKey | null>();
  let active: string | null = null;
  let activeOrigin = "";
  let connected = false;
  let releases: (() => void)[] = [];
  const readScope = () => ({
    target: scope.target,
    workKey: scope.work ? workKey(scope.work.handle.key) : null,
    workRevision: scope.work?.handle.revision ?? null,
    work: scope.work?.doc ?? null,
    page: view.read().page,
  });
  // Page is a built-in graph input, not a host reading or a second writable Page.
  const needsPage =
    !graph.readings.page && Object.values(graph.readings).some((r) => r.deps?.includes("page"));
  let readings: ReturnType<typeof createReadingGraph<P, W>>;
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
        log: (entry) => adapters.logReading?.(entry),
      },
    );
  } catch (cause) {
    view.dispose();
    base.dispose();
    registry.dispose();
    throw cause;
  }
  const basis = () =>
    Object.fromEntries(
      Object.keys(graph.readings).map((id) => {
        const state = readings.get(id);
        return [id, { version: state.version, current: state.current, basis: state.basis }];
      }),
    );
  const journalFor = (key: WorkKey) => {
    const id = workKey(key);
    let journal = journals.get(id);
    if (!journal) {
      journal = createWorkJournal(key);
      journals.set(id, journal);
    }
    if (connected && !disposed && !deltas.has(id))
      deltas.set(
        id,
        adapters.subscribeAcceptedDeltas(key, (ack) => {
          journal!.accept(ack);
          notify();
        }),
      );
    return journal;
  };
  if (scope.work) journalFor(scope.work.handle.key);
  const unTimeline = timeline.subscribe((entry) => {
    const key =
      entry.basis && typeof entry.basis === "object" && "workKey" in entry.basis
        ? entry.basis.workKey
        : null;
    if (typeof key === "string") journals.get(key)?.record(entry);
    notify();
  });
  const write = async (key: WorkKey, request: WorkWrite) => {
    const result = await adapters.write(key, request);
    if (result.ok && !disposed) journalFor(key).accept(result.write);
    notify();
    return result;
  };
  const acceptReceipt = (receipt: ActionReceipt, key: WorkKey | null, press?: string) => {
    if (disposed) return;
    if (receipt.state === "waiting" || receipt.state === "running") return;
    key = unsettledWorks.has(receipt.id)
      ? unsettledWorks.get(receipt.id)!
      : press && dispatches.has(press)
        ? dispatches.get(press)!.key
        : key;
    unsettledWorks.delete(receipt.id);
    const declaration = commands[receipt.key as keyof typeof commands];
    readings.acceptReceipt(receipt, declaration?.dirties ?? []);
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
    caller: "human",
    subjects: { ...adapters.subjects, ...kernel.subjects },
    snapshot: () => ({
      target: scope.target,
      work: scope.work,
      basis: { pageEpoch: view.read().epoch, readings: basis() },
    }),
    write: (key, envelope) => write(key, { ...envelope, kind: "apply" }),
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
            dispatches.set(press, { key, verb: id, readings: ids, origin: activeOrigin });
            timeline.append({
              kind: "invocation",
              at: Date.now(),
              press,
              verb: id,
              basis: { workKey: key ? workKey(key) : null },
            });
            for (const reading of ids) readings.start(reading, press);
            return work(cancelWith, press);
          },
          keys,
          stopped,
          label,
          wait,
        ),
    },
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
        if (dispatch) {
          if ("receipt" in result && result.receipt) {
            if (["detached", "waiting", "running"].includes(result.receipt.state))
              unsettledWorks.set(result.receipt.id, dispatch.key);
            else if (result.receipt.state !== "detached")
              acceptReceipt(result.receipt, dispatch.key, result.press);
          }
          for (const reading of dispatch.readings) readings.finish(reading, result.press);
          dispatches.delete(result.press);
        }
      }
    }
    notify();
    return result;
  };
  const cellSubject = (row: unknown): VerbSubject | null => {
    const subject =
      row === undefined
        ? null
        : (adapters.cell?.(row, { ...scope, page: view.read().page }) ?? null);
    if (subject && !kernel.placement[subject.type])
      throw Error(`Row resolved unknown cell type '${subject.type}'`);
    return subject;
  };
  const binding = (id: string, row?: unknown): MountBinding =>
    kernel.verbs[id]
      ? { subject: cellSubject(row), args: {} }
      : (adapters.binding?.(id, row, { ...scope, page: view.read().page }) ?? {
          subject: null,
          args: {},
        });
  const run = async (id: string, bound: MountBinding, origin: string, answers?: unknown) => {
    if (disposed || !available())
      return {
        state: "refused" as const,
        press: null,
        refusal: refuse("not-ready", "This route is inactive"),
      };
    const verb = verbs[id];
    if (!verb) throw Error(`Unknown verb ${id}`);
    const review = reviews.get(id);
    // Another press cannot steal the running invocation's identity.
    active = id;
    activeOrigin = origin;
    const result = review
      ? await commit(context, verb, review.ticket, answers)
      : await invoke(context, verb, bound.subject, bound.args);
    return consume(id, result);
  };
  const cancelReviews = () => {
    for (const { verb, ticket } of reviews.values())
      void invoke(context, verbs[verb]!, ticket.subject, ticket.input, {
        kind: "cancel",
        ticket,
      }).then((result) => consume(verb, result));
    reviews.clear();
  };
  return {
    registry,
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
      const origin = canonicalRouteInput([place, bound]);
      const control = bind(verbs[id]!, { ctx: context, ...bound });
      const reason = () =>
        disposed || !available()
          ? "This route is inactive"
          : reviews.has(id)
            ? reviews.get(id)!.origin === origin
              ? null
              : "Finish this verb's review at its original control"
            : control.refusal;
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
    stage() {
      const entry = graphFields(graph).find(([, f]) => f.role === "stage");
      const value = entry ? view.read().page[entry[0] as keyof P] : undefined;
      return typeof value === "string" && graph.stages[value]
        ? value
        : (graph.stageOrder ?? Object.keys(graph.stages))[0]!;
    },
    journal: journalFor,
    async restore(direction: "undo" | "redo") {
      if (!scope.work || disposed || !available()) return null;
      const key = structuredClone(scope.work.handle.key);
      const result = await journalFor(key)[direction]((request) => write(key, request));
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
        scope = adapters.getSnapshot();
        if (scope.work) journalFor(scope.work.handle.key);
        readings.update(readScope());
        notify();
      };
      for (const journal of journals.values()) journalFor(journal.key);
      releases = [
        adapters.subscribe(update),
        view.subscribe(() => {
          readings.update(readScope());
          notify();
        }),
        ...Object.keys(graph.readings).map((id) => readings.subscribe(id, notify)),
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
      readings.dispose();
      view.dispose();
      base.dispose();
      registry.dispose();
      listeners.clear();
    },
  };
}

export type GraphMount<P, W> = ReturnType<typeof createGraphMount<P, W>>;
