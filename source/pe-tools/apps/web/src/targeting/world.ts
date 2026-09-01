import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Cause } from "effect";
import type {
  DocOperationResult,
  DocRecentsResult,
  Envelope,
  RecentDocument,
  SessionHrColdResult,
  SessionHrFailureResult,
  SessionHrHotResult,
  SessionStartFailureResult,
  SessionStartPlanResult,
  SessionStartResult,
  SessionStopDetailResult,
  SessionStopFailureResult,
  SessionStopResult,
} from "@pe/host-contracts/pe-revit-contract";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { addressSchema } from "@pe/agent-contracts";

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

type WorldLifecycleAction = "start" | "restart" | "stop";

export interface WorldStart {
  readonly lane: "installed" | "dev";
  readonly year: string;
  readonly doc?: string;
}

type WorldLifecycleResults = {
  readonly start: SessionStartPlanResult | SessionStartResult | SessionStartFailureResult;
  readonly restart: SessionHrHotResult | SessionHrColdResult | SessionHrFailureResult;
  readonly stop: SessionStopResult | SessionStopDetailResult | SessionStopFailureResult;
};

export type WorldLifecycleReceipt = {
  [Action in WorldLifecycleAction]: { readonly action: Action } & Envelope<
    WorldLifecycleResults[Action]
  >;
}[WorldLifecycleAction];

type WorldOption = Option & { readonly world: WorldFacts };

const worldLabel = (world: Pick<WorldFacts, "custody" | "id" | "pid" | "session">) =>
  world.session?.sdkSessionId ??
  (world.custody === "observed" ? `Revit ${world.pid ?? world.id}` : world.id);

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

const lifecycleRefusal = (action: WorldLifecycleAction, world?: WorldFacts) =>
  action !== "start" && !world ? `${action} needs a bound world` : null;

async function runLifecycle<Action extends WorldLifecycleAction>(
  action: Action,
  world?: WorldFacts,
  start?: WorldStart,
): Promise<Extract<WorldLifecycleReceipt, { readonly action: Action }>> {
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
  const body = (await response.json()) as SdkEnvelope<WorldLifecycleResults[Action]>;
  if (!body.result)
    throw Error(sdkError(body, `${action} failed (${response.status})`));
  return { action, ...body } as Extract<WorldLifecycleReceipt, { readonly action: Action }>;
}

const describe = (receipt: WorldLifecycleReceipt) =>
  [
    `${receipt.action} · ${receipt.result.state}`,
    ...receipt.diagnostics.map((diagnostic) => diagnostic.detail ?? diagnostic.code),
    ...receipt.nextSteps,
  ].join(" · ");

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
      options: source.worlds
        .filter((world) => world.session || world.row)
        .map((world) => worldOption(world, source.sessions)),
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

export const openLocalDocuments = (
  session: HostOpResponse<"revit.context.document-session">,
) =>
  session.openDocuments.flatMap((document) => {
    const path = !document.isModelInCloud && addressSchema.safeParse(document.path);
    return path && path.success
      ? [{ id: path.data, label: document.title, active: document.isActive }]
      : [];
  });

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

async function openSdkDocument(
  session: SessionFacts,
  path: string,
  conflictPolicy?: "keep",
): Promise<Partial<DocOperationResult>> {
  if (!session.sdkSessionId) throw Error("open the document in Revit; this session is observed");
  const response = await fetch("/docs/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      id: session.sdkSessionId,
      ...(conflictPolicy ? { conflictPolicy } : {}),
    }),
  });
  const body = (await response.json()) as SdkEnvelope<DocOperationResult>;
  if (!response.ok || body.result?.state !== "ok")
    throw Error(sdkError(body, `document open failed (${response.status})`));
  return body.result;
}

async function cloneSdkDocument(session: SessionFacts, source: string, out: string) {
  if (!session.sdkSessionId) throw Error("clone the document in Revit; this session is observed");
  const response = await fetch("/docs/clone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, out, id: session.sdkSessionId }),
  });
  const body = (await response.json()) as SdkEnvelope<DocOperationResult>;
  if (response.ok && body.result?.state === "ok") return body.result;
  if (body.diagnostics?.some((diagnostic) => diagnostic.code === "doc.output-exists")) {
    await openSdkDocument(session, out);
    return;
  }
  throw Error(sdkError(body, `document clone failed (${response.status})`));
}

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
    open: readonly Option[] = [],
  ): Feed {
    if (AsyncResult.isFailure(active))
      return {
        options: null,
        state: "error",
        lane,
        stale: false,
        note: String(Cause.squash(active.cause)),
      };
    return feed(
      active,
      (current) => {
        const options: Option[] = current
          ? [{ id: current.documentId, label: current.title }]
          : [];
        const seen = new Set(options.map((option) => option.id));
        for (const option of open) {
          if (!seen.has(option.id)) options.push(option);
          seen.add(option.id);
        }
        if (recents && AsyncResult.isSuccess(recents))
          for (const item of recents.value.value) {
            const id = item.modelGuid ?? item.path;
            if (seen.has(id)) continue;
            options.push({ id, label: item.title, sub: item.isCloud ? "cloud" : item.path });
            seen.add(id);
          }
        return options;
      },
      lane,
    );
  },
  async pick(
    session: SessionFacts,
    documentId: string,
    recents: readonly RecentDocument[],
  ): Promise<string> {
    const recent = recents.find((item) => (item.modelGuid ?? item.path) === documentId);
    if (!recent) throw Error(`unknown recent document ${documentId}`);
    await openSdkDocument(
      session,
      recent.isCloud ? `recent:${recent.title}` : recent.path,
      recent.isCloud ? "keep" : undefined,
    );
    return `opened ${recent.title}`;
  },
  async activate(session: SessionFacts, path: string): Promise<string> {
    await openSdkDocument(session, path);
    return `activated ${path}`;
  },
  async clone(session: SessionFacts, source: string, out: string): Promise<string> {
    await cloneSdkDocument(session, source, out);
    return `opened ${out}`;
  },
};
