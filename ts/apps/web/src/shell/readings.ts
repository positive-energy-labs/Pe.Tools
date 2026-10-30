import { canonicalRouteInput } from "@pe/agent-contracts";
import type {
  ActionReceipt,
  DocumentRef,
  Effect,
  ExecutionTarget,
  ReadingDecl,
  WorkKey,
} from "@pe/agent-contracts";

export interface ReadingScope<P = unknown, W = unknown> {
  target: ExecutionTarget;
  workKey: WorkKey | null;
  workRevision: number | null;
  page: Readonly<P>;
  work: Readonly<W> | null;
  settings?: Readonly<Record<string, unknown>>;
}

export interface ReadingAttempt {
  readonly target: ExecutionTarget;
  readonly workKey: WorkKey | null;
  readonly generation: number;
}

export interface ReadingBasis {
  readonly attempt: ReadingAttempt;
  readonly inputs: Readonly<Record<string, number>>;
  readonly workRevision: number | null;
  readonly algorithmVersion?: string;
  readonly sourceVersion?: string;
}

export interface ReadingState<T = unknown> {
  readonly status: "absent" | "pending" | "partial" | "ready" | "stale" | "failed";
  readonly value?: T;
  readonly previous?: T;
  /** Only a complete, fresh observation can be a mutation basis. */
  readonly current: boolean;
  readonly complete: boolean;
  readonly basis: ReadingBasis | null;
  readonly version: number;
  readonly error?: string;
}

export type ReadingPublication<T = unknown> =
  | {
      kind: "part" | "complete";
      value: T;
      revision: number;
      sourceVersion?: string;
      fresh?: boolean;
    }
  | { kind: "pending" | "stale" }
  | { kind: "failure"; error: unknown }
  | { kind: "log"; value: unknown; id?: string };

export interface ReadingContext extends ReadingScope {
  readonly attempt: ReadingAttempt;
  /** Sources subscribe on demand; an expensive capture starts only for an explicit invocation. */
  readonly trigger: { kind: "demand" } | { kind: "verb"; invocation: string };
  readonly args: unknown;
  readonly inputs: Readonly<Record<string, ReadingState>>;
  readonly signal: AbortSignal;
}

export type ReadingDelivery<T = unknown> = (publication: ReadingPublication<T>) => void;
type Release = () => void;
interface SourcePolicy {
  /** Source-owned input selection, e.g. parameter slots; unrelated Work edits do not reacquire it. */
  key?(scope: ReadingScope): unknown;
  /** Defaults to the attempt's exact document/session. Disk and service sources declare theirs. */
  effects?(context: ReadingContext): readonly Effect[];
  dirties?: readonly string[];
}
export interface UseSource<T = unknown> extends SourcePolicy {
  kind: "use" | "feed";
  open(
    context: ReadingContext,
    deliver: ReadingDelivery<T>,
  ): void | Release | Promise<void | Release>;
}
export interface DeriveSource<T = unknown> extends SourcePolicy {
  kind: "derive";
  derive(context: ReadingContext): T;
}
export interface WorkerChannel<T = unknown> {
  update(context: ReadingContext, deliver: ReadingDelivery<T>): void;
  stop(): void;
}
export interface WorkerSource<T = unknown> extends SourcePolicy {
  kind: "worker";
  readonly algorithmVersion: string;
  connect(): WorkerChannel<T>;
}
export interface PortSession<T = unknown> {
  value: T;
  close(): void;
}
export interface PortSource<T = unknown> extends SourcePolicy {
  kind: "port";
  open(context: ReadingContext): PortSession<T> | Promise<PortSession<T>>;
}
export type ReadingSource<T = unknown> =
  | UseSource<T>
  | DeriveSource<T>
  | WorkerSource<T>
  | PortSource<T>;

export interface ReadingLog {
  kind: "drop" | "feed" | "failure";
  reading: string;
  attempt: ReadingAttempt;
  message?: string;
  value?: unknown;
  id?: string;
}
export interface ReadingGraphDeps<P, W> {
  sources: Readonly<Record<string, ReadingSource>>;
  scope: ReadingScope<P, W>;
  log(entry: ReadingLog): void;
}
export class ReadingGraphRefusal extends Error {}

interface Node<P> {
  id: string;
  decl: ReadingDecl<P>;
  source: ReadingSource;
  state: ReadingState;
  demand: number;
  mounted: number;
  generation: number;
  revision: number;
  signature?: string;
  /** What the last attempt ran against; a failed reading holds while this still matches. */
  launched?: { stable: string; values: unknown[] };
  context?: ReadingContext;
  trigger?: ReadingContext["trigger"];
  receiptHeld?: "capture" | "demand";
  release?: Release;
  controller?: AbortController;
  worker?: WorkerChannel;
  invocation?: string;
  pin?: Release;
  listeners: Set<() => void>;
  feedIds: Set<string>;
  effects?: readonly Effect[];
}

/** Validates the runtime source graph before any source can acquire resources. */
export function createReadingGraph<P, W>(
  graph: { readings: Readonly<Record<string, ReadingDecl<P>>> },
  deps: ReadingGraphDeps<P, W>,
) {
  const nodes = new Map<string, Node<P>>();
  for (const [id, decl] of Object.entries(graph.readings)) {
    const source = deps.sources[decl.source];
    if (!source || source.kind !== decl.kind)
      throw new ReadingGraphRefusal(`Reading ${id}: unresolved ${decl.kind} source ${decl.source}`);
    nodes.set(id, {
      id,
      decl,
      source,
      demand: 0,
      mounted: 0,
      generation: 0,
      revision: -1,
      state: { status: "absent", current: false, complete: false, basis: null, version: 0 },
      listeners: new Set(),
      feedIds: new Set(),
    });
  }
  const order: Node<P>[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new ReadingGraphRefusal(`Reading dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new ReadingGraphRefusal(`Unresolved reading dependency ${id}`);
    visiting.add(id);
    for (const input of node.decl.deps ?? []) visit(input);
    visiting.delete(id);
    visited.add(id);
    order.push(node);
  };
  for (const id of nodes.keys()) visit(id);

  let scope = structuredClone(deps.scope);
  let disposed = false;
  let batching = false;
  let flushing = false;
  const changed = new Set<Node<P>>();
  const receiptVersions = new Set<string>();
  const get = (id: string) => {
    const node = nodes.get(id);
    if (!node) throw new ReadingGraphRefusal(`Unknown reading ${id}`);
    return node;
  };
  const inputsOf = (node: Node<P>) =>
    Object.fromEntries((node.decl.deps ?? []).map((id) => [id, get(id).state]));
  const signatureOf = (node: Node<P>) =>
    canonicalRouteInput([
      node.source.key?.(scope),
      node.decl.retire === "page" ? node.decl.args?.(scope.page) : null,
      (node.decl.deps ?? []).map((id) => get(id).state.version),
      node.source.kind === "worker" ? [scope.workRevision, node.source.algorithmVersion] : null,
    ]);
  /** Signature minus the dependency version ticks: the inputs' values by identity, the rest by key. */
  const inputsIdentity = (node: Node<P>) => ({
    stable: canonicalRouteInput([
      node.source.key?.(scope),
      node.decl.retire === "page" ? node.decl.args?.(scope.page) : null,
      node.source.kind === "worker" ? [scope.workRevision, node.source.algorithmVersion] : null,
    ]),
    values: (node.decl.deps ?? []).map((id) => get(id).state.value),
  });
  /**
   * A failed attempt stays failed until its inputs or scope change: a mere dependency tick (a new
   * version over the same values) does not re-run it. A forced retire clears the signature, which
   * always re-runs; a press (`start`) launches directly.
   */
  const holdsFailure = (node: Node<P>) => {
    if (node.state.status !== "failed" || node.signature === undefined || !node.launched)
      return false;
    const now = inputsIdentity(node);
    return (
      now.stable === node.launched.stable &&
      now.values.every((value, i) => value === node.launched!.values[i])
    );
  };
  const owned = (node: Node<P>, attempt: ReadingAttempt) =>
    !disposed && node.context?.attempt === attempt;
  const put = (node: Node<P>, state: Omit<ReadingState, "version">) => {
    node.state = Object.freeze({ ...state, version: node.state.version + 1 });
    changed.add(node);
  };
  const detach = (node: Node<P>) => {
    // Revoke permission before abort/cleanup: both may synchronously deliver a last frame.
    node.context = undefined;
    node.controller?.abort();
    node.controller = undefined;
    const release = node.release;
    node.release = undefined;
    release?.();
  };
  const stale = (node: Node<P>, clearPrior = false) => {
    detach(node);
    put(
      node,
      clearPrior
        ? { status: "stale", current: false, complete: false, basis: null }
        : { ...node.state, status: "stale", current: false },
    );
  };
  const deliver = (node: Node<P>, context: ReadingContext, publication: ReadingPublication) => {
    const attempt = context.attempt;
    if (!owned(node, attempt)) {
      deps.log({
        kind: "drop",
        reading: node.id,
        attempt,
        message: `Retired attempt: ${publication.kind}`,
      });
      return;
    }
    if (publication.kind === "pending" && node.state.complete) {
      deps.log({
        kind: "drop",
        reading: node.id,
        attempt,
        message: "Completed attempt cannot become pending",
      });
      return;
    }
    if (publication.kind === "log") {
      if (node.source.kind !== "feed") throw new ReadingGraphRefusal(`${node.id} is not a feed`);
      const feedId =
        publication.id && canonicalRouteInput([attempt.target, attempt.workKey, publication.id]);
      if (feedId && node.feedIds.has(feedId)) return;
      if (feedId) {
        node.feedIds.add(feedId);
        if (node.feedIds.size > 200) node.feedIds.delete(node.feedIds.values().next().value!);
      }
      deps.log({
        kind: "feed",
        reading: node.id,
        attempt,
        value: publication.value,
        id: publication.id,
      });
      return;
    }
    if (publication.kind === "part" || publication.kind === "complete") {
      if (
        !Number.isSafeInteger(publication.revision) ||
        publication.revision < 0 ||
        publication.revision <= node.revision ||
        (node.state.complete && publication.kind === "part")
      ) {
        deps.log({
          kind: "drop",
          reading: node.id,
          attempt,
          message: "Regressive reading revision/completeness",
        });
        return;
      }
      node.revision = publication.revision;
      const complete = publication.kind === "complete";
      const fresh =
        publication.fresh !== false && Object.values(context.inputs).every((s) => s.current);
      put(node, {
        status: !fresh ? "stale" : complete ? "ready" : "partial",
        value: publication.value,
        previous: node.state.previous,
        complete,
        current: complete && fresh,
        basis: {
          attempt,
          inputs: Object.fromEntries(
            Object.entries(context.inputs).map(([id, s]) => [id, s.version]),
          ),
          workRevision: context.workRevision,
          ...(node.source.kind === "worker"
            ? { algorithmVersion: node.source.algorithmVersion }
            : {}),
          sourceVersion: publication.sourceVersion,
        },
      });
    } else if (publication.kind === "failure") {
      const error =
        publication.error instanceof Error ? publication.error.message : String(publication.error);
      put(node, { ...node.state, status: "failed", complete: false, current: false, error });
      deps.log({ kind: "failure", reading: node.id, attempt, message: error });
    } else {
      put(node, { ...node.state, status: publication.kind, complete: false, current: false });
    }
    flush();
    if (owned(node, attempt) && publication.kind === "failure") {
      node.invocation = undefined;
      const release = node.pin;
      node.pin = undefined;
      release?.();
    }
  };
  const launch = (node: Node<P>, acquire = true) => {
    if (node.state.status === "failed") {
      node.worker?.stop();
      node.worker = undefined;
    }
    detach(node);
    node.signature = signatureOf(node);
    node.launched = inputsIdentity(node);
    const controller = new AbortController();
    node.controller = controller;
    const attempt: ReadingAttempt = Object.freeze({
      target: structuredClone(scope.target),
      workKey: scope.workKey,
      generation: ++node.generation,
    });
    const context: ReadingContext = {
      ...scope,
      attempt,
      trigger: node.invocation ? { kind: "verb", invocation: node.invocation } : { kind: "demand" },
      args: structuredClone(node.decl.args?.(scope.page)),
      inputs: inputsOf(node),
      signal: controller.signal,
    };
    node.context = context;
    node.trigger = context.trigger;
    node.receiptHeld = undefined;
    node.revision = -1;
    put(node, {
      status: "pending",
      complete: false,
      current: false,
      previous: Object.hasOwn(node.state, "value") ? node.state.value : node.state.previous,
      basis: null,
    });
    // Consumers observe the verb's pending state before even a synchronous adapter answers.
    for (const notify of node.listeners) notify();
    if (!acquire) return attempt;
    if (
      !owned(node, attempt) ||
      Object.values(context.inputs).some((input) => input.value === undefined)
    )
      return attempt;
    const emit: ReadingDelivery = (part) => deliver(node, context, part);
    const keep = (release: void | Release) => {
      if (!release) return;
      if (owned(node, attempt)) node.release = release;
      else release();
    };
    try {
      const source = node.source;
      node.effects = source.effects?.(context) ?? targetEffects(context.target);
      if (source.kind === "derive") {
        emit({ kind: "complete", value: source.derive(context), revision: 0 });
      } else if (source.kind === "worker") {
        node.worker ??= source.connect();
        node.worker.update(context, emit);
      } else if (source.kind === "port") {
        const opened = source.open(context);
        const accept = (session: PortSession) => {
          keep(() => session.close());
          emit({ kind: "complete", value: session.value, revision: 0 });
        };
        if (opened instanceof Promise)
          void opened.then(accept, (error: unknown) => emit({ kind: "failure", error }));
        else accept(opened);
      } else {
        const opened = source.open(context, emit);
        if (opened instanceof Promise)
          void opened.then(keep, (error: unknown) => emit({ kind: "failure", error }));
        else keep(opened);
      }
    } catch (error) {
      emit({ kind: "failure", error });
    }
    return attempt;
  };
  function flush() {
    if (batching || flushing || disposed) return;
    flushing = true;
    try {
      for (const node of order) {
        if (!node.demand) continue;
        if (node.receiptHeld === "capture" || (node.receiptHeld === "demand" && !node.mounted))
          continue;
        const inputs = Object.values(inputsOf(node));
        if (inputs.some((input) => input.value === undefined)) {
          if (node.context && node.signature !== signatureOf(node)) stale(node);
          continue;
        }
        if (node.signature === signatureOf(node)) continue;
        if (holdsFailure(node)) node.signature = signatureOf(node);
        else launch(node);
      }
      const notifications = [...changed];
      changed.clear();
      for (const node of notifications) for (const notify of node.listeners) notify();
    } finally {
      flushing = false;
    }
  }
  const closure = (ids: readonly string[]) => {
    const selected = new Set<Node<P>>();
    const include = (node: Node<P>) => {
      if (selected.has(node)) return;
      selected.add(node);
      for (const id of node.decl.deps ?? []) include(get(id));
    };
    for (const id of ids) include(get(id));
    return order.filter((node) => selected.has(node));
  };
  const retain = (ids: readonly string[], acquire: boolean) => {
    if (disposed) throw new ReadingGraphRefusal("Reading graph is disposed");
    const selected = closure(ids);
    for (const node of selected) {
      node.demand++;
      if (acquire) node.mounted++;
    }
    if (acquire) flush();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const node of selected.toReversed()) {
        node.demand--;
        if (acquire) node.mounted--;
        if (node.demand || disposed) continue;
        detach(node);
        node.worker?.stop();
        node.worker = undefined;
        node.signature = undefined;
        put(node, {
          ...node.state,
          status: node.state.status === "failed" ? "failed" : "stale",
          current: false,
        });
      }
      flush();
    };
  };

  return {
    /** Observation alone creates no demand. The pane adapter owns the returned release. */
    subscribe(id: string, notify: () => void): Release {
      const node = get(id);
      node.listeners.add(notify);
      return () => {
        node.listeners.delete(notify);
      };
    },
    get(id: string): ReadingState {
      return get(id).state;
    },
    mount(ids: readonly string[]): Release {
      return retain(ids, true);
    },
    /** A press pins acquisition until its invocation finishes, fails, or is explicitly stopped. */
    start(id: string, invocation: string, acquire = true): ReadingAttempt {
      if (disposed) throw new ReadingGraphRefusal("Reading graph is disposed");
      const node = get(id);
      const previousPin = node.pin;
      node.pin = retain([id], false);
      previousPin?.();
      node.invocation = invocation;
      batching = true;
      let attempt: ReadingAttempt;
      try {
        for (const input of closure(node.decl.deps ?? [])) {
          if (!input.context) launch(input);
        }
        attempt = launch(node, acquire);
      } finally {
        batching = false;
      }
      flush();
      return attempt;
    },
    publish(id: string, invocation: string, attempt: ReadingAttempt, value: unknown) {
      const node = get(id);
      const context = node.context;
      if (!context || node.invocation !== invocation || !owned(node, attempt)) return;
      deliver(node, context, { kind: "complete", value, revision: node.revision + 1 });
    },
    fail(id: string, invocation: string, attempt: ReadingAttempt, error: string) {
      const node = get(id);
      const context = node.context;
      if (!context || node.invocation !== invocation || !owned(node, attempt)) return;
      deliver(node, context, { kind: "failure", error });
    },
    /** Release only the invocation's demand, after its result/basis has been consumed. */
    finish(id: string, invocation: string) {
      if (disposed) return;
      const node = get(id);
      if (node.invocation !== invocation) return;
      node.invocation = undefined;
      const release = node.pin;
      node.pin = undefined;
      release?.();
    },
    update(next: ReadingScope<P, W>) {
      if (disposed) return;
      const previousPage = scope.page;
      const targetChanged = canonicalRouteInput(scope.target) !== canonicalRouteInput(next.target);
      const workChanged = canonicalRouteInput(scope.workKey) !== canonicalRouteInput(next.workKey);
      scope = structuredClone(next);
      batching = true;
      try {
        for (const node of order) {
          const retire =
            workChanged ||
            (targetChanged && node.decl.retire !== "never") ||
            (node.decl.retire === "page" &&
              canonicalRouteInput(node.decl.args?.(previousPage)) !==
                canonicalRouteInput(node.decl.args?.(scope.page)));
          if (!retire) continue;
          stale(node, workChanged || targetChanged);
          node.signature = undefined;
          node.receiptHeld = undefined;
          node.invocation = undefined;
          const release = node.pin;
          node.pin = undefined;
          release?.();
        }
      } finally {
        batching = false;
      }
      flush();
    },
    /** Explicit Stop belongs to the invocation. Pane release never calls this. */
    cancel(id: string, invocation: string) {
      if (disposed) return;
      const node = get(id);
      if (node.invocation !== invocation) return;
      stale(node);
      node.worker?.stop();
      node.worker = undefined;
      node.invocation = undefined;
      const release = node.pin;
      node.pin = undefined;
      release?.();
      flush();
    },
    acceptReceipt(
      receipt: Pick<ActionReceipt, "id" | "state" | "effects" | "target">,
      dirties: readonly string[] = [],
    ) {
      if (disposed) return;
      if (receipt.state === "waiting" || receipt.state === "running") return;
      const stamp = canonicalRouteInput([receipt.id, receipt.state, receipt.effects, dirties]);
      if (receiptVersions.has(stamp)) return;
      receiptVersions.add(stamp);
      if (receiptVersions.size > 200)
        receiptVersions.delete(receiptVersions.values().next().value!);
      const effects = receipt.effects.length ? receipt.effects : targetEffects(receipt.target);
      invalidate((node) => {
        if (node.source.kind === "port") return false;
        if (!node.context && !node.state.basis) return false;
        const readingEffects = node.effects ?? [];
        const named =
          !dirties.length ||
          dirties.includes(node.id) ||
          (node.source.dirties ?? []).some((key) => dirties.includes(key));
        return (
          named &&
          (readingEffects.length === 0
            ? dirties.length > 0
            : effects.some((a) => readingEffects.some((b) => overlaps(a, b))))
        );
      }, true);
    },
    documentChanged(ref: DocumentRef) {
      invalidate((node) => {
        return (
          node.source.kind !== "port" &&
          (node.effects ?? []).some((effect) => overlaps({ kind: "document", ref }, effect))
        );
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of order.toReversed()) {
        detach(node);
        node.worker?.stop();
        put(node, { ...node.state, status: "stale", current: false });
        node.listeners.clear();
        node.pin = undefined;
      }
      changed.clear();
    },
  };

  function invalidate(matches: (node: Node<P>) => boolean, receipt = false) {
    if (disposed) return;
    batching = true;
    try {
      const invalidated = new Set<string>();
      for (const node of order) {
        const dependency = receipt && (node.decl.deps ?? []).some((id) => invalidated.has(id));
        if (receipt && node.source.kind === "port") {
          if (dependency) node.receiptHeld = "capture";
          continue;
        }
        if (matches(node) || dependency) {
          invalidated.add(node.id);
          const capture = node.trigger?.kind === "verb";
          stale(node);
          node.invocation = undefined;
          const release = node.pin;
          node.pin = undefined;
          release?.();
          // Receipt-dirtied use/feed/worker readings and their derives reacquire only with current
          // mounted demand; unmounted ones wait for demand. Ports and verb-triggered captures never
          // auto-reacquire (nor retry a timed-out native operation). Document changes only fence.
          node.receiptHeld = receipt ? (capture ? "capture" : "demand") : node.receiptHeld;
          node.signature = receipt && !capture ? undefined : signatureOf(node);
        }
      }
    } finally {
      batching = false;
    }
    flush();
  }
}

export type ReadingGraph<P, W> = ReturnType<typeof createReadingGraph<P, W>>;

function targetEffects(target: ExecutionTarget): readonly Effect[] {
  return target.kind === "document"
    ? [{ kind: "document", ref: target.ref }]
    : target.kind === "session"
      ? [{ kind: "session", session: target.session }]
      : [];
}
function overlaps(a: Effect, b: Effect): boolean {
  if (a.kind === "session" && b.kind === "document") return a.session === b.ref.session;
  if (b.kind === "session" && a.kind === "document") return b.session === a.ref.session;
  if (a.kind === "directory" && (b.kind === "file" || b.kind === "directory")) {
    const root = a.path.replaceAll("\\", "/").replace(/\/$/, "");
    const path = b.path.replaceAll("\\", "/");
    return path === root || path.startsWith(`${root}/`);
  }
  if (b.kind === "directory") return a.kind === "file" && overlaps(b, a);
  if (a.kind === "member" && b.kind === "member")
    return (
      a.pod === b.pod &&
      a.path === b.path &&
      (!a.location || !b.location || a.location === b.location)
    );
  return canonicalRouteInput(a) === canonicalRouteInput(b);
}
