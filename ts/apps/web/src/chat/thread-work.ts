import { useMemo, useState } from "react";
import {
  threadWorkSnapshotSchema,
  type Reading,
  type ThreadWork,
  type ThreadWorkSnapshot,
  type WorkResume,
} from "@pe/agent-contracts";
import { CHAT_SEED_THREAD_WORK } from "#/chat/seeds";
import { peClient } from "#/host/pe-client";
import { previousOf, useReading } from "#/readings";

/** The one swap point: the `thread-work` Reading's last good snapshot, checked at the boundary.
 *  Nothing yet (or a malformed payload) is null, and rows keep their conversation titles. */
const threadWorksOf = (reading: Reading<unknown>): ThreadWorkSnapshot | null =>
  threadWorkSnapshotSchema.safeParse(previousOf(reading)).data ?? null;

/** One snapshot for the whole sidebar, indexed by thread; rows look up, never read. `?demo=` keeps
 *  its fixture and asks the host nothing. */
export function useThreadWorks() {
  // `?demo=` is read once at mount, as the workbench reads its seed.
  const [demo] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo"),
  );
  const reading = useReading(demo ? null : { kind: "thread-work" });
  const snapshot = demo ? CHAT_SEED_THREAD_WORK : threadWorksOf(reading);
  return useMemo(
    () => ({
      demo,
      snapshot,
      of: new Map(snapshot?.threads.map((work) => [work.threadId, work])),
    }),
    [demo, snapshot],
  );
}

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
      document.availability === "open"
        ? document.name
        : `${document.name} (${document.availability})`,
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

/** A Work on a closed document resumes its retained or reconnect state, never the live session:
 *  Address Work answers its durable `url` even closed; unknown or unreadable Work answers `url:
 *  null` and a truthful `reason`. A refusal (404 for an unknown id) is that reason too, so the
 *  row stays pressable and says why in its hint. */
/** A pressed Work whose document is closed: what the tool shows while it waits to reconnect. */
export type ClosedWork = {
  documentId: string | null;
  document: string | null;
  intent: string;
  unfinished: number;
};

export type Resumed = Pick<WorkResume, "url" | "reason" | "matches"> & {
  key: WorkResume["key"] | null;
};
export async function resumeWork(workId: string): Promise<Resumed> {
  try {
    return await peClient.call("work.resume", { query: { id: workId } });
  } catch (error) {
    const said = (error as { problem?: { error?: unknown } }).problem?.error;
    return {
      key: null,
      url: null,
      matches: [],
      reason:
        typeof said === "string" ? said : error instanceof Error ? error.message : String(error),
    };
  }
}
