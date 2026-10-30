import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { PageSnapshot } from "./view-owner";
/** Presentation facts shared by the retained ladder and specimens; execution belongs to shell/. */
import type {
  Reading,
  RouteStatePatch,
  TargetResolution,
  WorkKey,
  WorkHandle,
  ActionStatus,
} from "@pe/agent-contracts";

import type { ActionFacts } from "./facts";
import type { PresentationFacts } from "./facts";
import type { PageMove } from "#/shell/page";
import type { Refusal } from "./refusal";
import type { LogEntry, RouteNote } from "#/shell/owner";
import type { BindingLost, TargetProvenance } from "./route-target";

export interface ActionHandle extends ActionFacts {
  readonly label: string;
  readonly chord?: string;
  readonly refusal: string | null; // the manifest's `ready()` sentence; null = runnable
  readonly stage?: string;
  /** Page state the verb carries ("Partition 10"); null = none. */
  readonly count: number | null;
  readonly run: (input?: unknown) => Promise<Refusal | null>;
}

/** What the last run of an action left behind: the action, and its refusal or nothing. */
export interface RouteOutcome<A extends string> {
  readonly key: A;
  readonly label: string;
  readonly refusal: Refusal | null;
  /** The wait was stopped from the flag; the host call itself was not cancelled. */
  readonly stopped: boolean;
  /** When it landed; a flag dismissed once stays dismissed for this outcome. */
  readonly at: number;
}

export interface RouteHandle<W, R extends string, P, A extends string> {
  readonly manifest: PresentationFacts<R>;
  readonly resolution: TargetResolution;
  readonly targetProvenance: TargetProvenance;
  /** The `?target` pin: a view over one document, never written by the route; null falls back read-only to the sole user document. */
  readonly chosen: string | null;
  /** The selected conversation, a view association only; never a target default. */
  readonly thread: string | null;
  readonly work: {
    readonly key: WorkKey;
    /** Addressless: this Work belongs to one unsaved document's lifetime and dies with it. */
    readonly ephemeral: boolean;
    readonly doc: W | null;
    readonly revision: number | null;
    readonly handle: () => WorkHandle | null;
    readonly busy: ActionStatus | null;
    /** Whether the authoritative Work reading is current, including a current absent document. */
    readonly current: boolean;
    /** Revit changed the Work's document after the read its edit rungs rest on (`takenAt`). */
    readonly changed: boolean;
    /** `expectedRevision` binds the write; `null` binds it to nothing rendered and refuses. */
    readonly write: (
      patches: RouteStatePatch[],
      expectedRevision?: number | null,
    ) => Promise<Refusal | null>;
    /** Another writer landed first; the last write was refused. `reload` reads Work again. */
    readonly conflict: boolean;
    /** The owner's own sentence when Work cannot be read (e.g. saved in an older shape). */
    readonly refusal: string | null;
    /**
     * Human-only: sets the unreadable Work aside, untouched, and starts an empty Work. A refusal
     * lands on `failure`; success re-reads Work. Null unless the failure is the host's UNREADABLE_WORK.
     */
    readonly startFresh: (() => Promise<Refusal | null>) | null;
    /**
     * Human-only, read-only: what the route's declared `salvage` carries over from Work it can no
     * longer read (the unreadable Work, else the newest aside). Null when there is none.
     */
    readonly salvage: (() => Promise<{ from: string; value: unknown } | null>) | null;
    readonly reload: () => void;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  /** The bridge inventory the resolution reads; a seed's `inventory` reading when seeded. */
  readonly inventory: Reading<unknown>;
  /**
   * The exact document this route was bound to (session › openId) is gone from the live
   * inventory. Its sentence is every verb's refusal; `reopened` is the same title open under a
   * new openId in that session, offered first and never taken for the person (F-X-1).
   */
  readonly bindingLost: BindingLost | null;
  /** The existing owner registry, also used by its derived Page consumers. */
  readonly registry: AtomRegistry.AtomRegistry;
  /** Canonical Page snapshot; attention derives selection without copying writable state. */
  readonly pageState: Atom.Atom<PageSnapshot<P>>;
  /** The Page and its setter; `{ history: "replace" }` marks a gesture's move (`PageMove`). */
  readonly page: readonly [P, (next: Partial<P>, move?: PageMove<P>) => void];
  readonly actions: Readonly<Record<A, ActionHandle>>;
  readonly busy: { readonly key: A; readonly seconds: number } | null;
  readonly stop: () => void; // stop waiting on the busy action (its flag's stop)
  readonly failure: Refusal | null;
  readonly outcome: RouteOutcome<A> | null;
  readonly log: readonly LogEntry[]; // the page log, newest first
  readonly note: RouteNote;
  readonly demo: boolean;
  /** Re-acquire these Readings, as a verb's `dirties` would; a pane's focus edge calls it. */
  revalidate(keys: readonly R[]): void;
}
