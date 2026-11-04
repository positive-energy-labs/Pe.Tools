import type { MountEnvironment } from "./mount-environment";
import type { LegacyVerbEnvironment } from "./legacy-environment-bridge";
import { type SettingsOwner } from "./settings";
import {
  validateRouteGraph,
  type ActionReceipt,
  type ActionStatus,
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
  type VerbReadingEdges,
  type WorkWriteAck,
} from "@pe/agent-contracts";

import { type ReadingLog, type ReadingSource, type ReadingState } from "./readings";

import { type TimelineEntry } from "./timeline";
import { validateGraphChords } from "./keys";

import { type WorkHistory, type VerbContext, type VerbSubject } from "./verbs";
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
export interface MountBinding {
  subject: VerbSubject | null;
  args: unknown;
}
/** What a verb binding may read: target, Work, Page and the current kernel reading states, one snapshot per call. */
export type BindingScope<P, W> = MountScope<W> & {
  page: P;
  readings: Readonly<Record<string, ReadingState>>;
};

export interface MountAdapters<P, W> extends VerbReadingEdges {
  environment?: MountEnvironment;
  legacyEnvironment?: LegacyVerbEnvironment;
  selectPage?(page: P): void;
  readingSources?: Readonly<Record<string, ReadingSource>>;
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
  /** Stage authored command choices through an existing Work verb before opening its review. */
  stageBefore?(
    id: string,
    bound: MountBinding,
    scope: BindingScope<P, W>,
  ): { verb: string; input: unknown } | null;
  /** The cell subject (`cell:<seg|key>`) a pane row stands for, or null; the kernel's cell verbs follow it. */
  cell?(row: unknown, scope: BindingScope<P, W>): VerbSubject | null;
  /** Native effects name their actual Work footprint; [[]] explicitly means the whole Work. */
  receiptPaths?(receipt: ActionReceipt, key: WorkKey): readonly RouteStatePatch["path"][];
  subscribeReceipts?(
    accept: (receipt: ActionReceipt | ActionStatus, key: WorkKey | null, press?: string) => void,
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
  const refusals = validateRouteGraph(
    graph,
    adapters && { verbReadings: adapters.verbReadings, verbDepends: adapters.verbDepends },
  );
  // validateRouteGraph also handles malformed runtime inputs; do not traverse those again.
  if (refusals.some((r) => r.code === "invalid-graph")) return refusals;
  const all = [...refusals, ...validateGraphChords(graph)];
  const invalid = (path: string, message: string) =>
    all.push({ code: "invalid-graph", path, message });
  if (!Object.keys(graph.stages).length) invalid("stages", "A route needs at least one stage");
  if (adapters)
    for (const [id, reading] of Object.entries(graph.readings))
      if (adapters.sources[reading.source]?.kind !== reading.kind)
        invalid(`readings.${id}.source`, `Unresolved ${reading.kind} source '${reading.source}'`);
  return all;
}
