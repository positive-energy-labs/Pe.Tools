import * as React from "react";
import * as kit from "@pe/kit";
import { z } from "zod";
import {
  pane,
  podRouteStateSchema,
  split,
  workKey,
  machineAttachments,
  type Machine,
  type PodRouteDescriptor,
  type RouteGraph,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { mountRoute, type GraphMount, type MountBody, type RouteAdapters } from "#/shell/mount";
import { operationVerb, queryVerb, rpcVerb, workVerb, type InvocationResult } from "#/shell/verbs";
import { podOperation, podRead, podRequest, podScript, podExport, podSources } from "./pod-sources";
import { podRoutePath } from "./pod-address";
import { actionResult } from "../../../../packages/mcps/src/shared/takeoff-action-client";

type State = Record<string, unknown>;
type Work = { version: 1; state: State };
type Page = { request: z.output<typeof podRequest> };
type Event = Record<string, unknown>;
export interface PodApi {
  React: typeof React;
  kit: typeof kit;
  useState(): { state: State; fire(this: void, event: Event): Promise<void> };
  getState(): State;
  target(): Promise<{ session: string; openId: string; title: string }>;
  read(key: string, input: State): Promise<unknown>;
  do(key: string, input: State): Promise<unknown>;
  exportSnapshot(snapshot: unknown): Promise<void>;
}
export interface PodRouteBundle {
  version: number;
  initial: State;
  reducer(state: State, event: Event): State;
  create(api: PodApi): React.ComponentType;
  fixtures?: Readonly<
    Record<string, { title: string; state: State; queries?: Readonly<Record<string, unknown>> }>
  >;
}

/** Reviews stay open in the kernel; the bundle receives only the final admitted outcome. */
async function invocation(
  owner: GraphMount<Page, Work>,
  id: string,
  input?: unknown,
  signal?: AbortSignal,
) {
  let outcome = await owner.control(id, input).run();
  if (outcome.state === "review") {
    const press = outcome.press;
    outcome = await new Promise<InvocationResult>((resolve, reject) => {
      const abort = () => {
        release();
        reject(Error("This Pod editor is no longer mounted."));
      };
      const check = () => {
        const next = owner.results.get(id);
        if (next?.press !== press || next.state === "review") return;
        release();
        signal?.removeEventListener("abort", abort);
        resolve(next);
      };
      const release = owner.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }
  if (outcome.state !== "done")
    throw Error("refusal" in outcome ? outcome.refusal.message : "Review is still open");
  return outcome;
}
async function result(
  owner: GraphMount<Page, Work>,
  id: string,
  input?: unknown,
  signal?: AbortSignal,
) {
  const outcome = await invocation(owner, id, input, signal);
  return "receipt" in outcome
    ? outcome.kind === "command"
      ? actionResult(outcome.receipt)
      : outcome.receipt.value
    : undefined;
}

/** An ACK owns the inverse; the Work reading owns the next reducer's input. Never predict either. */
function readAcknowledged(owner: GraphMount<Page, Work>, ack: WorkWriteAck, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timer);
      release();
      signal.removeEventListener("abort", abort);
      if (error) reject(Error(error));
      else resolve();
    };
    const abort = () => finish("This Pod editor is no longer mounted.");
    const check = () => {
      const work = owner.snapshot().work;
      if (work && workKey(work.handle.key) !== workKey(ack.key))
        finish("This route's Work changed after the edit.");
      else if (work && work.handle.revision >= ack.revision) finish();
    };
    const release = owner.subscribe(check);
    const timer = setTimeout(
      () =>
        finish(
          "The edit was accepted, but its Work reading has not arrived; reload Work before editing again.",
        ),
      15_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
}

/** One trusted module declares one executable graph; no second manifest or writer exists. */
export function makePodRoute(row: PodRouteDescriptor, bundle: PodRouteBundle) {
  if (!row.trusted) throw Error("Trust this Pod route hash before loading.");
  if (
    bundle.version !== 1 ||
    typeof bundle.create !== "function" ||
    typeof bundle.reducer !== "function" ||
    !bundle.initial ||
    typeof bundle.initial !== "object" ||
    Array.isArray(bundle.initial)
  )
    throw Error("This Pod route does not implement route bundle version 1.");
  const graph: RouteGraph<Page, Work> = {
    key: row.workRoute,
    address: podRoutePath(row.key).slice(1),
    name: row.name,
    // Calculator inputs are host-owned; choosing a document scopes operations, never replaces inputs.
    optionalTarget: "document",
    work: podRouteStateSchema.extend({
      state: podRouteStateSchema.shape.state.default(() => structuredClone(bundle.initial)),
    }),
    fields: {
      request: {
        ...field(
          podRequest.default({ key: "", input: {} }),
          {},
          { encode: JSON.stringify, decode: JSON.parse },
        ),
        role: "draft",
        url: false,
        agent: false,
      },
    },
    readings: {
      state: { kind: "derive", source: "pod.state", retire: "target" },
      machine: { kind: "use", source: "pod.machine", retire: "never" },
    },
    verbs: {
      edit: workVerb(
        { label: "Edit Pod state", input: z.record(z.string(), z.unknown()) },
        {
          patches: (scope, event) => [
            {
              path: ["state"],
              value: bundle.reducer((scope.snapshot.work!.doc as Work).state, event),
            },
          ],
        },
      ),
      reset: workVerb(
        { label: "Reset authored state", input: z.object({}).default({}) },
        {
          patches: () => [{ path: ["state"], value: structuredClone(bundle.initial) }],
        },
      ),
      read: queryVerb(podRead, { label: "Read Pod operation", input: podRequest, review: "none" }),
      script: queryVerb(podScript, { label: "Read Pod script", input: podRequest, review: "none" }),
      execute: operationVerb(
        podRead,
        { label: "Run Pod action", input: podRequest },
        {
          ready: (scope, input) =>
            !input.key
              ? "Choose a Pod action"
              : scope.snapshot.target.kind !== "document"
                ? "Choose an exact document"
                : null,
          raw: (_, input) => ({ key: podOperation(input.key).key, input: input.input }),
          intent: (_, input) => input,
        },
      ),
      export: rpcVerb(
        podExport(row),
        {
          label: "Export portable Page",
          input: z.object({ snapshot: z.unknown() }),
          caller: "human",
          review: "none",
        },
        { intent: (_, input) => input },
      ),
    },
    panes: {
      instrument: {
        label: row.name,
        purpose: row.description,
        draws: ["state", "machine"],
        verbs: [],
      },
      history: {
        label: "History",
        purpose: "Inspect Pod edits and admitted host actions",
        draws: [],
        verbs: [],
        history: {},
      },
    },
    layout: split(
      "pod",
      { axis: "v", sized: "end", size: 160 },
      pane("instrument"),
      pane("history"),
    ),
    stages: {
      use: {
        word: row.name,
        panes: ["instrument", "history"],
        verbs: ["reset", "execute"],
        teach: row.description,
      },
    },
    pick: false,
    seeds: Object.fromEntries(
      Object.entries(bundle.fixtures ?? {}).map(([name, seed]) => [
        name,
        {
          title: seed.title,
          load: async () => ({
            work: { version: 1 as const, state: structuredClone(seed.state) },
            readings: { state: seed.state, machine: null },
            queries: seed.queries,
            target: {
              kind: "document" as const,
              ref: { session: "fixture", openId: row.workRoute },
            },
          }),
        },
      ]),
    ),
  };
  function Instrument({ owner }: MountBody<Page, Work>) {
    const [error, setError] = React.useState<string | null>(null);
    const lifetime = React.useRef(new AbortController());
    const active = React.useRef(true);
    React.useEffect(() => {
      lifetime.current = new AbortController();
      active.current = true;
      return () => {
        active.current = false;
        lifetime.current.abort();
      };
    }, []);
    const api = React.useMemo<PodApi>(() => {
      let queue = Promise.resolve();
      const state = () => owner.snapshot().work?.doc.state ?? bundle.initial;
      const fire = (event: Event) => {
        const input = structuredClone(event);
        const basis = owner.context.snapshot();
        const run = queue.then(async () => {
          const current = owner.context.snapshot();
          if (
            !active.current ||
            basis.generation !== current.generation ||
            !basis.work ||
            !current.work ||
            workKey(basis.work.handle.key) !== workKey(current.work.handle.key)
          )
            throw Error("This route's Work changed before the edit; choose it again.");
          const outcome = await invocation(owner, "edit", input);
          if (outcome.kind === "work")
            await readAcknowledged(owner, outcome.acknowledgement, lifetime.current.signal);
        });
        queue = run.catch((cause: unknown) => setError(String(cause)));
        return run;
      };
      return {
        React,
        kit,
        useState: () => ({ state: state(), fire }),
        getState: state,
        target: async () => {
          const target = owner.snapshot().target;
          if (target.kind !== "document")
            throw Error("Choose an exact document in this route's target picker.");
          const reading = owner.readings.get("machine");
          const document =
            reading.current && reading.value
              ? machineAttachments(reading.value as Machine)
                  .find((a) => a.session === target.ref.session)
                  ?.documents?.find((d) => d.openId === target.ref.openId)
              : null;
          if (!document && !owner.fixture)
            throw Error("The exact document's title is not current; wait for its reading.");
          return { ...target.ref, title: document?.title ?? "Fixture document" };
        },
        read: (key, input) => result(owner, "read", { key, input }),
        do: async (key, input) => {
          const generation = owner.context.snapshot().generation;
          await queue;
          if (generation !== owner.context.snapshot().generation)
            throw Error("The Pod target changed before execution.");
          if (key.startsWith("script:")) {
            const captured = (await result(owner, "script", { key, input })) as z.output<
              typeof podRequest
            >;
            key = captured.key;
            input = captured.input;
          }
          if (podOperation(key).intent.toLowerCase() === "read")
            return result(owner, "read", { key, input });
          owner.view.setPage({ request: { key, input } });
          return result(owner, "execute", undefined, lifetime.current.signal);
        },
        exportSnapshot: (snapshot) => result(owner, "export", { snapshot }).then(() => {}),
      };
    }, [owner]);
    const View = React.useMemo(() => bundle.create(api), [api]);
    return (
      <>
        {error && (
          <p role="alert" data-tone="alarm">
            {error}
          </p>
        )}
        <View />
      </>
    );
  }
  const adapters: RouteAdapters<Page, Work> = {
    sources: podSources,
    binding: (id, row, scope) => ({
      subject: null,
      args: id === "execute" ? scope.page.request : (row ?? {}),
    }),
    bodies: { instrument: (body) => <Instrument {...body} /> },
  };
  const View = mountRoute(graph, adapters);
  return {
    graph,
    manifest: graph,
    adapters,
    hosted: ({
      visible,
      ...props
    }: {
      visible: boolean;
      thread: string;
      target?: string;
      work?: string;
    }) => <View {...props} hidden={!visible} url={false} />,
  };
}
