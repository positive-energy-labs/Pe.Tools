/** The handle a route gets back from `useRoute`: its resolution, Work, Readings, Page and one handle per action. */
import type { Reading, RouteStatePatch, TargetResolution, WorkKey } from "@pe/agent-contracts";
import type { useThreadScope } from "#/chat/scope";
import type { ActionFacts } from "./facts";
import type { RouteManifest } from "./manifest";
import type { Refusal } from "./refusal";
import type { LogEntry, RouteNote } from "./route-owner";
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
  readonly manifest: RouteManifest<W, R, P, A>;
  readonly resolution: TargetResolution;
  readonly targetProvenance: TargetProvenance;
  /** The `?target` pin: a view over one document, never written by the route; null reads the head. */
  readonly chosen: string | null;
  /** The thread head, the one target store; null on a route that names no thread. */
  readonly head: {
    readonly thread: string;
    /** Move the thread's target; the head refuses when stale or while a turn holds it. */
    readonly set: ReturnType<typeof useThreadScope>["set"];
    readonly refusal: string | null;
    /** The head has been read once; a set before that is refused. */
    readonly hydrated: boolean;
  } | null;
  readonly work: {
    readonly key: WorkKey;
    /** Addressless: this Work belongs to one unsaved document's lifetime and dies with it. */
    readonly ephemeral: boolean;
    readonly doc: W | null;
    readonly revision: number | null;
    /** Whether the authoritative Work reading is current, including a current absent document. */
    readonly current: boolean;
    /** Revit changed the Work's document after the read its staged rungs rest on (`takenAt`). */
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
  readonly page: readonly [P, (next: Partial<P>) => void];
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
