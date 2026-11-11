/**
 * Push off the one notice feed (ADR 0035 rule 7): the tray card and the OS notification follow the
 * host's `notices` Reading, whose every frame is the whole `NoticeFeed`, and raise a row only when
 * its revision moved past what this follower last saw of that key. The follower keeps that record
 * (`seen`, one revision per key of the last feed) across reconnects and reloads, so a reconnect
 * neither repeats nor skips. A first follow (no record) owes nothing earlier: it only records.
 * `notice-policy.ts` then decides whether a raised row shows (acknowledged, snoozed, looking).
 */
import { noticeFeedSchema, type MachineNotice, type NoticeRow } from "@pe/agent-contracts";

import { peReadings, type Readings } from "#/host/resource-stream";

export type NoticeSeen = Readonly<Record<string, number>>;

/** Rows that interrupt a person: working rows and staged Work stay in Activity, never a card. */
const pushes = (row: NoticeRow) => row.group !== "working" && row.verb !== "review";

export function followNotices(options: {
  /** The tray's own card follows `as: "tray"`: its rows carry `attended`. */
  as?: "tray";
  /** What this follower saw of the last feed; null on a first follow. */
  seen: NoticeSeen | null;
  onRow: (row: NoticeRow) => void;
  /** Called after each feed with the record to keep. */
  onSeen: (seen: NoticeSeen) => void;
  onTray?: (present: boolean) => void;
  /** The tab's one stream carries the feed; its owner reconnects, and this record spans it. */
  readings?: Pick<Readings, "subscribe">;
}): () => void {
  const { onRow, onSeen, onTray, readings = peReadings } = options;
  let seen = options.seen;
  return readings.subscribe(
    { kind: "notices", ...(options.as ? { as: options.as } : {}) },
    (frame) => {
      if (frame.kind !== "snapshot" || frame.stale) return;
      const feed = noticeFeedSchema.safeParse(frame.value);
      if (!feed.success) return;
      onTray?.(feed.data.tray);
      if (seen)
        for (const row of feed.data.rows)
          if (pushes(row) && (seen[row.key] ?? -1) < row.revision) onRow(row);
      seen = Object.fromEntries(feed.data.rows.map((row) => [row.key, row.revision]));
      onSeen(seen);
    },
  );
}

/** The card's drawing input, built from a feed row; the host sends rows, never cards. */
export function cardOf(row: NoticeRow): MachineNotice {
  const act = row.act;
  const title =
    act?.kind === "consent"
      ? `${act.deadline ? "Reject? Pea will write" : "Allow Pea to write?"} · ${row.what}`
      : act?.kind === "question"
        ? `Pea is asking · ${row.what}`
        : act?.kind === "reply"
          ? row.what
          : row.key.startsWith("thread:") && row.group === "failed"
            ? `Pea stopped · ${row.what}`
            : `${row.what} · ${row.verb}`;
  const option = (o: { optionId: string } | undefined, name: string, kind: string) =>
    o ? [{ optionId: o.optionId, name, kind }] : [];
  return {
    id: row.key,
    revision: row.revision,
    title,
    body: row.says ?? "",
    ...(row.url ? { href: row.url } : {}),
    ...(row.attended ? { attended: true } : {}),
    ...(act?.kind === "consent"
      ? {
          act: {
            kind: "permission" as const,
            threadId: act.threadId,
            requestId: act.requestId,
            ...(act.deadline ? { deadline: act.deadline } : {}),
            options: [
              ...option(act.allow, "Allow", "allow_once"),
              ...option(act.reject, "Reject", "reject_once"),
            ],
          },
        }
      : act?.kind === "question"
        ? {
            act: {
              kind: "question" as const,
              threadId: act.threadId,
              requestId: act.requestId,
              message: row.says ?? "",
              requestedSchema: act.requestedSchema,
            },
          }
        : act?.kind === "reply" || act?.kind === "automatic-updates"
          ? { act }
          : {}),
  };
}
