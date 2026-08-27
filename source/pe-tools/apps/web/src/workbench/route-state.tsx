/** Thread-scoped route documents over the host RouteWorkspace API. */
import { useAtomValue } from "@effect/atom-react";
import { Cause, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { z } from "zod";

import {
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

export type { RouteStatePatch, RouteStateWriteResult } from "@pe/agent-contracts";

import { appAtomRegistry } from "#/state/registry";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  fail,
  failuresNote,
  type Scope,
  type VerbFailure,
} from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";

type LastCommand = { command: string; input?: unknown } | null;

export interface RouteStateHandle<T> {
  slice: T | null;
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<RouteStateWriteResult>;
  command: (command: string, input?: unknown) => Promise<RouteStateWriteResult>;
  peaActive: boolean;
  connected: boolean | null;
  failure: VerbFailure | null;
  busy: string | null;
  lastCommand: LastCommand;
}

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  scope: Scope,
): RouteStateHandle<z.infer<TSchema>> {
  const store = useRouteStore(() => createRouteStateStore(appAtomRegistry, spec, scope));
  const wireResult = useAtomValue(store.slice);
  const busy = useAtomValue(store.busy);
  const failure = useAtomValue(store.failure);
  const lastCommand = useAtomValue(store.lastCommand);
  const wire = AsyncResult.isSuccess(wireResult) ? wireResult.value : null;
  const wireFailure = AsyncResult.isFailure(wireResult) ? wireResult.cause : null;
  const wireError = wireFailure
    ? Option.getOrElse(
        Option.map(Cause.findErrorOption(wireFailure), (caught) => caught.message),
        () => "wire failed",
      )
    : (wire?.error ?? null);

  return {
    slice: wire?.doc ?? null,
    revision: wire?.revision ?? null,
    hydrated: wire?.hydrated ?? false,
    apply: store.apply,
    command: store.command,
    peaActive: wire?.peaActive ?? false,
    connected: wireFailure ? false : (wire?.connected ?? null),
    failure: failure ?? (wireError ? { kind: "error", verb: "wire", message: wireError } : null),
    busy: busy?.id ?? null,
    lastCommand,
  };
}

function createRouteStateStore<TSchema extends z.ZodType>(
  registry: AtomRegistry.AtomRegistry,
  spec: RouteStateSpec<TSchema>,
  scope: Scope,
) {
  const core = createRouteStoreCore(`card/${spec.route}`, registry);
  const slice = core.owned("slice/document", docAtom(spec, scope));
  const writer = docWriter(spec, scope, registry, slice);
  const lastCommand = core.owned("page/last-command", Atom.make<LastCommand>(null));
  /** A command that lands with per-item failures is a `partial`, not a success. */
  const run = (verb: string, write: () => Promise<RouteStateWriteResult>) =>
    core.runVerb(verb, async (): Promise<RouteStateWriteResult> => {
      const result = await write();
      const partial = result.ok ? failuresNote(result, "value") : null;
      return partial ? fail(partial, "partial") : result;
    }, [spec.route]);
  return {
    registry,
    slice,
    busy: core.busy,
    failure: core.failure,
    lastCommand,
    apply: (patches: RouteStatePatch[], expectedRevision?: number) =>
      run("apply", () => writer.apply(patches, expectedRevision)),
    command: async (command: string, input?: unknown) => {
      const result = await run(command, () =>
        writer.command(command as keyof TSchema & string, input),
      );
      if (result.ok) registry.set(lastCommand, { command, input });
      return result;
    },
    dispose: core.dispose,
  };
}
