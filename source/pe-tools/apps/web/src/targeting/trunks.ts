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

interface FleetFeed {
  readonly worlds: readonly WorldFacts[];
  readonly sessions: readonly SessionFacts[];
  readonly isLoading: boolean;
  readonly stale: boolean;
  readonly error: Error | null;
  readonly at?: number;
  readonly basis: readonly string[];
  readonly lane?: Lane;
}

const worldOptions = (worlds: readonly WorldFacts[], sessions: readonly SessionFacts[]): Option[] =>
  worlds.map((world) => {
    const sdkSessionId = world.session?.sdkSessionId ?? world.row?.id;
    return {
      id: world.session ? mintSelector(world.session, sessions) : `session:${world.row!.id}`,
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
    const lane = source.lane ?? "live";
    if (source.error)
      return {
        options: null,
        state: "error",
        lane,
        stale: false,
        note: source.error.message,
      };
    if (source.isLoading && source.worlds.length === 0)
      return { options: null, state: "loading", lane, stale: false };
    return {
      options: worldOptions(source.worlds, source.sessions),
      state: "ready",
      lane,
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
  ): Promise<string> {
    if (!session.sdkSessionId) throw Error("open the document in Revit; this session is observed");
    const recent = recents.find((item) => (item.modelGuid ?? item.path) === documentId);
    if (!recent) throw Error(`unknown recent document ${documentId}`);
    const response = await fetch("/docs/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // SHIM: Pe.Revit.Sdk NEXT.md cannot resolve cloud identities yet. (dies when: `doc open
        // <cld://…>` resolves)
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

export const folderTrunk = {
  link: {
    key: "folder",
    joiner: "beside",
    placeholder: "pick a folder",
    needs: "a host-visible folder holding .r10 files — add one below",
  } satisfies Link,
};

export const fileTerminal = (key: string, noun: string, dir: Dir) => ({
  link: {
    key,
    joiner: dir === "sync" ? "syncing" : dir === "read" ? "against" : "editing",
    placeholder: noun,
    needs: noun,
    dir,
    liveness: "detached",
  } satisfies Link,
});

export const profileTerminal = (dir: Extract<Dir, "read" | "duplex">) => ({
  link: {
    key: "profile",
    joiner: dir === "read" ? "against" : "editing",
    placeholder: "a family profile",
    needs:
      dir === "read"
        ? "a readable Family Foundry profile"
        : "a family document path visible to the bound world",
    dir,
    liveness: "detached",
  } satisfies Link,
});
