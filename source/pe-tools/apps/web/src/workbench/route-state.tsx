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
  type RouteWriteKind,
} from "@pe/agent-contracts";

export type { RouteStatePatch, RouteStateWriteResult } from "@pe/agent-contracts";

import { appAtomRegistry } from "#/state/registry";
import { createRouteStoreCore, docAtom, docWriter, type Scope } from "#/state/route-store";
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
  error: string | null;
  failureKind: RouteWriteKind | null;
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

  return {
    slice: wire?.doc ?? null,
    revision: wire?.revision ?? null,
    hydrated: wire?.hydrated ?? false,
    apply: store.apply,
    command: store.command,
    peaActive: wire?.peaActive ?? false,
    connected: wireFailure ? false : (wire?.connected ?? null),
    error:
      failure?.message ??
      (wireFailure
        ? Option.getOrElse(
            Option.map(Cause.findErrorOption(wireFailure), (caught) => caught.message),
            () => "wire failed",
          )
        : (wire?.error ?? null)),
    failureKind: failure?.kind ?? (wireFailure || wire?.error ? "error" : null),
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
  const run = (verb: string, write: () => Promise<RouteStateWriteResult>) =>
    core.runVerb(verb, async () => {
      const result = await write();
      const failure = routeWriteFailure(result);
      if (failure) throw Error(failure);
      return result;
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
      registry.set(lastCommand, { command, input });
      return result;
    },
    dispose: core.dispose,
  };
}

function routeWriteFailure(result: RouteStateWriteResult): string | null {
  if (!result.ok) return result.error ?? result.hint ?? "Route update failed.";
  const failures =
    result.result && typeof result.result === "object"
      ? (result.result as { failures?: unknown }).failures
      : undefined;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return `${failures.length} value${failures.length === 1 ? "" : "s"} failed${
    detail ? `: ${detail}` : "."
  }`;
}
