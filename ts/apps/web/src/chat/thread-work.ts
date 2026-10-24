import { useMemo, useState } from "react";
import type { ThreadWork, ThreadWorkSnapshot } from "@pe/agent-contracts";
import { CHAT_SEED_THREAD_WORK } from "#/chat/seeds";

/** The one swap point: the batch snapshot the sidebar reads, fed by the `?demo=` fixture.
 *  TODO(route thread: batch ThreadWork Reading on the resources stream): its request kind and
 *  door are theirs to name; the navigation HTTP projection is not this source. */
export const threadWorksOf = (reading: { threadWorks?: ThreadWorkSnapshot } | undefined) =>
  reading?.threadWorks ?? null;

/** One snapshot for the whole sidebar, indexed by thread; rows look up, never read. */
export function useThreadWorks() {
  // `?demo=` is read once at mount, as the workbench reads its seed.
  const [demo] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo"),
  );
  const snapshot = threadWorksOf(demo ? { threadWorks: CHAT_SEED_THREAD_WORK } : undefined);
  return useMemo(
    () => ({
      snapshot,
      of: new Map(snapshot?.threads.map((work) => [work.threadId, work])),
    }),
    [snapshot],
  );
}

/** One thread's Work from that same batch; never a request of its own. */
export const useThreadWork = (threadId: string) => useThreadWorks().of.get(threadId);

/** "Doc A +2"; null when the thread remembers no document (the row keeps its title). */
export function documentsLabel(work: ThreadWork | undefined): string | null {
  const [first, ...rest] = work?.documents ?? [];
  return first ? `${first.name}${rest.length ? ` +${rest.length}` : ""}` : null;
}

/** The Work a row's press opens: the most unfinished one; `unfinished` is the host's count. */
export const leadWork = (work: ThreadWork | undefined) =>
  work?.works.reduce<ThreadWork["works"][number] | undefined>(
    (lead, next) => (!lead || next.unfinished > lead.unfinished ? next : lead),
    undefined,
  );

/** Names and counts only: the row hint never carries an id. */
export function workHint(work: ThreadWork, title: string): string {
  const name = new Map(work.documents.map((document) => [document.id, document]));
  return [
    title,
    ...work.documents.map((document) =>
      document.availability === "open" ? document.name : `${document.name} (${document.availability})`,
    ),
    ...work.works.map(
      (item) =>
        `${item.intent}: ${item.unfinished} unfinished${
          item.documentId ? ` in ${name.get(item.documentId)?.name ?? "a document"}` : ""
        }`,
    ),
  ].join(" · ");
}

/** The sidebar's one quiet line when discovery was partial; null when it was whole. */
export const partialWork = (snapshot: ThreadWorkSnapshot | null) =>
  snapshot && (snapshot.truncated || snapshot.observations.length)
    ? {
        line: snapshot.truncated ? "Work list cut short" : "Work partly read",
        hint: snapshot.observations.join(" · ") || "the host bounded this read",
      }
    : null;

/** A Work on a closed document resumes its retained or reconnect state, never the live session.
 *  TODO(route thread): their Work-id resume lookup replaces this stub; null means "open the route". */
export async function resumeWork(_workId: string): Promise<{ link: string } | null> {
  return null;
}
