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
import type { VerbAtoms } from "#/components/verb-lane";
import { useRouteStore } from "#/state/use-route-store";

type LastCommand = { command: string; input?: unknown } | null;

export interface RouteStateHandle<T> {
  slice: T | null;
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<RouteStateWriteResult>;
  command: (command: string, input?: unknown, receipt?: string) => Promise<RouteStateWriteResult>;
  peaActive: boolean;
  connected: boolean | null;
  failure: VerbFailure | null;
  busy: string | null;
  atoms: VerbAtoms;
  lastCommand: LastCommand;
}

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  scope: Scope,
): RouteStateHandle<z.infer<TSchema>> {
  const store = useRouteStore(() => createRouteStateStore(appAtomRegistry, spec, scope));
  const wireResult = useAtomValue(store.slice);
  const busy = useAtomValue(store.atoms.busy);
  const failure = useAtomValue(store.atoms.failure);
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
    atoms: store.atoms,
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
  const run = (verb: string, write: () => Promise<RouteStateWriteResult>, receipt?: string) =>
    core.runVerb(verb, async (): Promise<RouteStateWriteResult & { text?: string }> => {
      const result = await write();
      const partial = result.ok ? failuresNote(result, "value") : null;
      if (partial) return fail(partial, "partial");
      return receipt ? { ...result, text: receipt } : result;
    }, [spec.route]);
  return {
    registry,
    slice,
    atoms: core.verbAtoms,
    lastCommand,
    apply: (patches: RouteStatePatch[], expectedRevision?: number) =>
      run("apply", () => writer.apply(patches, expectedRevision)),
    command: async (command: string, input?: unknown, receipt?: string) => {
      const result = await run(
        command,
        () => writer.command(command as keyof TSchema & string, input),
        receipt,
      );
      if (result.ok) registry.set(lastCommand, { command, input });
      return result;
    },
    dispose: () => core.dispose(),
  };
}
