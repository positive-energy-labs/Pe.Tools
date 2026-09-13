/**
 * The route-document card handle. Fold 5 moved the read side onto one Reading and the write side
 * onto one Refusal; this keeps the `RouteStateWriteResult` face its callers already speak by
 * mapping a Refusal back onto it, so a card still asks `result.ok`.
 */
import type { WorkKey } from "@pe/agent-contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { useContext } from "react";
import { z } from "zod";

import {
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

export type { RouteStatePatch, RouteStateWriteResult } from "@pe/agent-contracts";

import {
  appAtomRegistry,
  createRouteOwner,
  docAtom,
  docWriter,

  useRouteOwner,
  type Refusal,
} from "#/route";
import { previousOf } from "#/readings";
import { WorkbenchContext } from "./provider/thread-summary";
import type { OutcomeFailure } from "#/components/lang/outcome-strip";

/** The two atoms a route-state store publishes; the strip that draws them takes plain values. */
export interface OutcomeAtoms {
  busy: Atom.Atom<{ key: string; seconds: number } | null>;
  failure: Atom.Atom<Refusal | null>;
}

/** A Refusal wearing the write result's face. `partial` and `advisory` keep their own words. */
const asWriteResult = (refusal: Refusal | null, revision: number): RouteStateWriteResult =>
  refusal === null
    ? { ok: true, revision }
    : {
        ok: false,
        kind: refusal.code === "partial" ? "partial" : refusal.code === "busy" ? "advisory" : "refused",
        error: refusal.message,
        hint: "",
        ...(refusal.code === "stale-revision" ? { code: "stale_revision" as const } : {}),
      };

const asFailure = (refusal: Refusal | null): OutcomeFailure | null =>
  refusal === null
    ? null
    : {
        kind: refusal.code === "partial" ? "partial" : refusal.code === "busy" ? "advisory" : "error",
        action: refusal.code,
        message: refusal.message,
      };

type LastCommand = { command: string; input?: unknown } | null;

export interface RouteStateHandle<T> {
  slice: T | null;
  revision: number | null;
  hydrated: boolean;
  /** The stream is re-establishing over a slice we already hold. Not a disconnection. */
  refreshing: boolean;
  outcomeUnknown?: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<RouteStateWriteResult>;
  command: (
    command: string,
    input?: unknown,
    receipt?: string,
    expectedRevision?: number,
  ) => Promise<RouteStateWriteResult>;
  peaActive: boolean;
  connected: boolean | null;
  failure: OutcomeFailure | null;
  busy: string | null;
  atoms: OutcomeAtoms;
  lastCommand: LastCommand;
}

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  scope: WorkKey,
): RouteStateHandle<z.infer<TSchema>> {
  const store = useRouteOwner(() => createRouteStateStore(appAtomRegistry, spec, scope));
  const workbench = useContext(WorkbenchContext);
  const reading = useAtomValue(store.slice);
  const busy = useAtomValue(store.atoms.busy);
  const failure = useAtomValue(store.atoms.failure);
  const lastCommand = useAtomValue(store.lastCommand);
  const wire = previousOf(reading) ?? null;
  const wireError = reading.state === "failed" ? reading.message : null;

  return {
    slice: wire?.doc ?? null,
    revision: wire?.revision ?? null,
    hydrated: wire !== null,
    refreshing: reading.state === "loading" || reading.state === "stale",
    outcomeUnknown: wire?.outcomeUnknown ?? false,
    apply: store.apply,
    command: store.command,
    // Turn activity is the workbench thread stream, never a second subscription per document.
    peaActive: workbench?.isRunning ?? false,
    // `connected` still means writable: while the Reading is stale the writer refuses an
    // undeclared revision, so claiming a live bridge here would contradict the refusal.
    // `refreshing` separates a re-establishing stream from a dead one.
    connected: reading.state === "absent" ? null : reading.state === "ready",
    failure:
      asFailure(failure) ??
      (wireError ? { kind: "error", action: "wire", message: wireError } : null),
    busy: busy?.key ?? null,
    atoms: store.atoms,
    lastCommand,
  };
}

function createRouteStateStore<TSchema extends z.ZodType>(
  registry: AtomRegistry.AtomRegistry,
  spec: RouteStateSpec<TSchema>,
  scope: WorkKey,
) {
  const core = createRouteOwner(`card/${spec.route}`, registry);
  // The document slice is the family's SHARED atom: labelling it cloned the node, and every
  // clone opened its own route events stream.
  const slice = docAtom(spec, scope);
  const writer = docWriter(spec, scope, registry, slice);
  const lastCommand = core.owned("page/last-command", Atom.make<LastCommand>(null));
  const revisionNow = () => {
    const current = registry.get(slice);
    return previousOf(current)?.revision ?? 0;
  };
  const run = async (
    action: string,
    write: () => Promise<Refusal | null>,
  ): Promise<RouteStateWriteResult> => {
    const refusal = await core.runAction(action, write, [spec.route]);
    return asWriteResult(refusal, revisionNow());
  };
  // Authored patches QUEUE; they do not race the single-action lock. Each queued apply awaits the
  // previous one and carries its landed revision forward, because the slice is still stale on
  // the invalidation the previous apply triggered. An explicit expectedRevision always wins, so a
  // caller-declared conflict still conflicts, and the queue drains back to the store's revision.
  // ponytail: one queue per store; `command` keeps the lock — it leaves the page.
  let queue: Promise<unknown> = Promise.resolve();
  let queued = 0;
  let landed: number | null = null;
  const apply = (
    patches: RouteStatePatch[],
    expectedRevision?: number,
  ): Promise<RouteStateWriteResult> => {
    queued += 1;
    const result = queue
      .then(() =>
        run("apply", () => writer.apply(patches, expectedRevision ?? landed ?? undefined)),
      )
      // A refused action is a result, not an unhandled rejection: callers fire apply with `void`.
      .catch(
        (cause): RouteStateWriteResult =>
          asWriteResult(
            { code: "failed", message: cause instanceof Error ? cause.message : String(cause) },
            revisionNow(),
          ),
      );
    queue = result.then((written) => {
      if (written.ok) landed = written.revision;
      queued -= 1;
      if (queued === 0) landed = null;
    });
    return result;
  };
  return {
    registry,
    slice,
    atoms: { busy: core.busy, failure: core.failure },
    lastCommand,
    apply,
    command: async (
      command: string,
      input?: unknown,
      receipt?: string,
      expectedRevision?: number,
    ) => {
      void receipt;
      const result = await run(command, async () => {
        const refusal = await writer.command(
          command as keyof TSchema & string,
          input,
          expectedRevision,
        );
        return refusal;
      });
      if (result.ok) registry.set(lastCommand, { command, input });
      return result;
    },
    dispose: () => core.dispose(),
  };
}
