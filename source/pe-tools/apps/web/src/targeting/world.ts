import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Cause } from "effect";
import type {
  DocOpenResult,
  DocRecentsResult,
  Envelope,
  RecentDocument,
} from "@pe/host-contracts/pe-revit-contract";

import type { WorldFacts } from "#/host/fleet";
import { mintSelector, type SessionFacts } from "#/host/target";
import { feed, type Feed, type Lane, type TimedRead } from "#/state/route-store";
import type { Bound, Feeds, Link, Option, Verb } from "#/targeting/model";

type SdkEnvelope<T> = Omit<Partial<Envelope<T>>, "result"> & {
  readonly result?: Partial<T>;
  readonly error?: string;
};

const sdkError = (body: SdkEnvelope<unknown>, fallback: string) =>
  body.diagnostics?.[0]?.detail ?? body.error ?? fallback;

interface FleetFeed {
  readonly worlds: readonly WorldFacts[];
  readonly sessions: readonly SessionFacts[];
  readonly isLoading: boolean;
  readonly stale: boolean;
  readonly error: Error | null;
  readonly at?: number;
  readonly basis: readonly string[];
}

type WorldLifecycleAction = "start" | "converge" | "restart" | "stop";

export interface WorldStart {
  readonly lane: "installed" | "dev";
  readonly year: string;
  readonly doc?: string;
}

export interface WorldLifecycleReceipt {
  readonly action: WorldLifecycleAction;
  readonly ok: boolean;
  readonly state: string;
  readonly diagnostics: readonly string[];
  readonly nextSteps: readonly string[];
}

type WorldOption = Option & { readonly world: WorldFacts };

const worldLabel = (
  world: Pick<WorldFacts, "pid"> & Partial<Pick<WorldFacts, "session" | "row">>,
) => world.session?.sdkSessionId ?? world.row?.id ?? `Revit ${world.pid ?? 0}`;

const worldOption = (world: WorldFacts, sessions: readonly SessionFacts[]): WorldOption => ({
  id: world.session ? mintSelector(world.session, sessions) : `session:${worldLabel(world)}`,
  label: worldLabel(world),
  sub: world.custody,
  world,
});

const selectedWorld = <K extends string>(bound: Bound<K>, feeds: Feeds<K>) => {
  const key = "world" as K;
  const option = feeds[key].options?.find((candidate) => candidate.id === bound[key]);
  return (option as WorldOption | undefined)?.world;
};

const lifecycleRefusal = (action: WorldLifecycleAction, world?: WorldFacts) => {
  if (world?.custody === "observed")
    return `observed world ${worldLabel(world)} is read-only; pe-revit does not control its lifecycle`;
  if (action !== "start" && !world) return `${action} needs a bound world`;
  return null;
};

async function runLifecycle(
  action: WorldLifecycleAction,
  world?: WorldFacts,
  start?: WorldStart,
): Promise<WorldLifecycleReceipt> {
  const denied = lifecycleRefusal(action, world);
  if (denied) throw Error(denied);
  if (action === "start" && !start) throw Error("start needs lane and year");
  const response = await fetch("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      action === "start"
        ? { action, ...start }
        : {
            action,
            id: world!.id,
            ...(action === "stop" && world!.phase === "unresponsive" ? { force: true } : {}),
          },
    ),
  });
  const body = (await response.json()) as SdkEnvelope<{ readonly state: string }>;
  const diagnostics = (body.diagnostics ?? []).map(
    (diagnostic) => diagnostic.detail ?? diagnostic.code,
  );
  return {
    action,
    ok: response.ok && diagnostics.length === 0,
    state: body.result?.state ?? (response.ok ? "answered" : "failed"),
    diagnostics,
    nextSteps: body.nextSteps ?? [],
  };
}

const describe = (receipt: WorldLifecycleReceipt) =>
  [`${receipt.action} · ${receipt.state}`, ...receipt.diagnostics, ...receipt.nextSteps].join(
    " · ",
  );

const lifecycleVerb = <K extends string>(
  action: WorldLifecycleAction,
  start: () => WorldStart,
  settled: (receipt: WorldLifecycleReceipt) => void,
): Verb<K> => ({
  key: action,
  label: action,
  demands: action === "start" ? [] : (["world"] as K[]),
  kind: "commit",
  needs: action === "start" ? "a payload lane and Revit year" : "a controlled world",
  refuse: (bound, feeds) => lifecycleRefusal(action, selectedWorld(bound, feeds)),
  run: async (bound, feeds) => {
    const receipt = await runLifecycle(
      action,
      selectedWorld(bound, feeds),
      action === "start" ? start() : undefined,
    );
    settled(receipt);
    return describe(receipt);
  },
});

const worldLink: Link<"world"> = {
  key: "world",
  under: null,
  joiner: "in",
  placeholder: "pick a world",
  multi: false,
  needs: "a live world — start Revit with the Pe add-in, or start one from /instances",
  dir: null,
  liveness: "attached",
};

export const worldTrunk = {
  link: worldLink,
  label: worldLabel,
  option: worldOption,
  describe,
  resolve(worlds: readonly WorldFacts[], sessions: readonly SessionFacts[], target: string) {
    return worlds.find((world) => worldOption(world, sessions).id === target);
  },
  verbs<K extends string>(input: {
    start: () => WorldStart;
    started: (action: WorldLifecycleAction) => void;
    settled: (receipt: WorldLifecycleReceipt) => void;
    failed: (action: WorldLifecycleAction, error: unknown) => void;
    finished: () => void;
  }) {
    const verb = (action: WorldLifecycleAction) => {
      const created = lifecycleVerb<K>(action, input.start, input.settled);
      return {
        ...created,
        run: async (bound: Bound<K>, feeds: Feeds<K>) => {
          input.started(action);
          try {
            return await created.run(bound, feeds);
          } catch (error) {
            input.failed(action, error);
            return error instanceof Error ? error.message : `${action} failed`;
          } finally {
            input.finished();
          }
        },
      };
    };
    return {
      start: verb("start"),
      converge: verb("converge"),
      restart: verb("restart"),
      stop: verb("stop"),
    };
  },
  feed(source: FleetFeed): Feed {
    if (source.error)
      return {
        options: null,
        state: "error",
        lane: "live",
        stale: false,
        note: source.error.message,
      };
    if (source.isLoading && source.worlds.length === 0)
      return { options: null, state: "loading", lane: "live", stale: false };
    return {
      options: source.worlds.map((world) => worldOption(world, source.sessions)),
      state: "ready",
      lane: "live",
      stale: source.stale,
      at: source.at,
      basis: source.basis,
    };
  },
};

type ActiveDocument = {
  readonly documentId: string;
  readonly title: string;
};

const documentLink: Link = {
  key: "rvt",
  under: "world",
  joiner: "",
  placeholder: "no document",
  multi: false,
  needs: "the document arrives with the bound world",
  dir: null,
  liveness: null,
};

export const documentTrunk = {
  link: documentLink,
  async recents(year?: string): Promise<readonly RecentDocument[]> {
    const response = await fetch(`/docs/recents${year ? `?year=${encodeURIComponent(year)}` : ""}`);
    const body = (await response.json()) as SdkEnvelope<DocRecentsResult>;
    if (!response.ok || !body.result)
      throw Error(sdkError(body, `document recents failed (${response.status})`));
    return body.result.recents ?? [];
  },
  feed(
    active: AsyncResult.AsyncResult<TimedRead<ActiveDocument | null>, Error>,
    recents?: AsyncResult.AsyncResult<TimedRead<readonly RecentDocument[]>, Error>,
    lane: Lane = "live",
  ): Feed {
    if (!recents)
      return feed(
        active,
        (document) => (document ? [{ id: document.documentId, label: document.title }] : []),
        lane,
      );
    if (AsyncResult.isFailure(active))
      return {
        options: null,
        state: "error",
        lane,
        stale: false,
        note: String(Cause.squash(active.cause)),
      };
    return feed(
      recents,
      (items) => {
        const current = AsyncResult.isSuccess(active) ? active.value.value : null;
        return [
          ...(current ? [{ id: current.documentId, label: current.title }] : []),
          ...items
            .filter((item) => (item.modelGuid ?? item.path) !== current?.documentId)
            .map((item) => ({
              id: item.modelGuid ?? item.path,
              label: item.title,
              sub: item.isCloud ? "cloud" : item.path,
            })),
        ];
      },
      lane,
    );
  },
  async pick(
    session: SessionFacts,
    documentId: string,
    recents: readonly RecentDocument[],
  ): Promise<string> {
    if (!session.sdkSessionId) throw Error("open the document in Revit; this session is observed");
    const recent = recents.find((item) => (item.modelGuid ?? item.path) === documentId);
    if (!recent) throw Error(`unknown recent document ${documentId}`);
    const response = await fetch("/docs/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: recent.isCloud ? `recent:${recent.title}` : recent.path,
        id: session.sdkSessionId,
        ...(recent.isCloud ? { conflictPolicy: "keep" as const } : {}),
      }),
    });
    const body = (await response.json()) as SdkEnvelope<DocOpenResult>;
    if (!response.ok || body.result?.state !== "ok")
      throw Error(sdkError(body, `document open failed (${response.status})`));
    return `opened ${recent.title}`;
  },
};
