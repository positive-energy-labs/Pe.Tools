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
import type { Dir, Link, Option } from "#/targeting/model";

type SdkEnvelope<T> = Omit<Partial<Envelope<T>>, "result"> & {
  readonly result?: Partial<T>;
  readonly error?: string;
};

const sdkError = (body: SdkEnvelope<unknown>, fallback: string) =>
  body.diagnostics?.[0]?.detail ?? body.error ?? fallback;

export interface FleetFeed {
  readonly worlds: readonly WorldFacts[];
  readonly sessions: readonly SessionFacts[];
  readonly isLoading: boolean;
  readonly stale: boolean;
  readonly error: Error | null;
  readonly at?: number;
  readonly basis: readonly string[];
}

const worldOptions = (worlds: readonly WorldFacts[], sessions: readonly SessionFacts[]): Option[] =>
  worlds.map((world) => {
    const sdkSessionId = world.session?.sdkSessionId ?? world.row?.id;
    return {
      id: sdkSessionId
        ? `session:${sdkSessionId}`
        : world.session
          ? mintSelector(world.session, sessions)
          : `pid:${world.pid ?? 0}`,
      label: sdkSessionId ?? `Revit ${world.pid ?? 0}`,
      sub: world.custody,
    };
  });

const worldLink: Link = {
  key: "world",
  joiner: "in",
  placeholder: "pick a world",
  needs: "a live world — start Revit with the Pe add-in, or start one from /instances",
  liveness: "attached",
};

export const worldTrunk = {
  link: worldLink,
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
      options: worldOptions(source.worlds, source.sessions),
      state: "ready",
      lane: "live",
      stale: source.stale,
      at: source.at,
      basis: source.basis,
    };
  },
  fromSessions(
    result: AsyncResult.AsyncResult<TimedRead<readonly SessionFacts[]>, Error>,
    lane: Lane,
  ): Feed {
    return feed(
      result,
      (sessions) =>
        worldOptions(
          sessions.map((session) => ({
            id: session.sdkSessionId ?? session.sessionId,
            custody: session.custody,
            phase: "ready",
            lane: session.lane ?? undefined,
            pid: session.processId,
            activeDocumentTitle: session.activeDocumentTitle,
            openDocumentCount: session.openDocumentCount,
            session,
          })),
          sessions,
        ),
      lane,
    );
  },
};

type ActiveDocument = {
  readonly documentId: string;
  readonly title: string;
};

const documentLink: Link = {
  key: "rvt",
  parent: "world",
  joiner: "",
  placeholder: "no document",
  needs: "the document arrives with the bound world",
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
    invalidate?: () => void,
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
    invalidate?.();
    return `opened ${recent.title}`;
  },
};

type FeedBuilder = {
  readonly link: Link;
  feed<A>(
    result: AsyncResult.AsyncResult<TimedRead<A>, Error>,
    options: (value: A) => Option[],
    lane: Lane,
    seam?: { needs: string },
  ): Feed;
};

export const folderTrunk: FeedBuilder = {
  link: {
    key: "folder",
    joiner: "beside",
    placeholder: "pick a folder",
    needs: "a host-visible folder",
  },
  feed,
};

export const fileTerminal = (ext: string, dir: Dir): FeedBuilder => ({
  link: {
    key: ext.replace(/^\./, ""),
    joiner: dir === "sync" ? "syncing" : dir === "read" ? "against" : "editing",
    placeholder: `pick a ${ext}`,
    needs: `a readable ${ext} file`,
    dir,
    liveness: "detached",
  },
  feed,
});
