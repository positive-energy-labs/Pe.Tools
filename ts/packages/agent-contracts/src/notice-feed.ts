/**
 * The one notice feed (ADR 0035 rule 7). The host owns one `notices` Reading whose snapshot is
 * this feed: every row that needs a person or tells one what happened, already grouped. Push (the
 * tray card, the OS notification) and pull (home Activity, tray Activity, the Mod+Shift+K empty
 * state) read the same rows; nothing in the browser joins threads, receipts and Works again.
 *
 * `apps/host/src/notice-feed.ts` builds and serves it; `apps/web/src/navigation/notice-feed.ts`
 * reads it for pull, and `apps/web/src/machine/notice-follow.ts` follows it for push.
 */
import { z } from "zod";

/** In the order the eye takes them; waits and working lead and never fold. */
export const NOTICE_GROUPS = ["waits", "working", "interrupted", "failed", "unread"] as const;
export const noticeGroupSchema = z.enum(NOTICE_GROUPS);
export type NoticeGroup = z.infer<typeof noticeGroupSchema>;

/** The door a row opens, when a press answers it instead of only landing on it. */
export const noticeActSchema = z.discriminatedUnion("kind", [
  /** Run consent (ADR 0027 rule 11): a countdown with Reject; the topbar sweep draws it. */
  z.strictObject({
    kind: z.literal("consent"),
    threadId: z.string().min(1),
    requestId: z.string().min(1),
    /** ISO instant the host auto-approves at; absent while auto-approve is off. */
    deadline: z.string().optional(),
    reject: z.strictObject({ optionId: z.string().min(1) }).optional(),
    /** The ask's allow option: the tray card answers in place while auto-approve is off. */
    allow: z.strictObject({ optionId: z.string().min(1) }).optional(),
  }),
  z.strictObject({
    kind: z.literal("question"),
    threadId: z.string().min(1),
    requestId: z.string().min(1),
    /** The form the answer fills; the row's `says` is the question. */
    requestedSchema: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ kind: z.literal("reply"), threadId: z.string().min(1) }),
  /** A host-restart death: Resume re-sends the turn the restart cut off. */
  z.strictObject({ kind: z.literal("resume"), threadId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("automatic-updates") }),
]);
export type NoticeAct = z.infer<typeof noticeActSchema>;

export const noticeRowSchema = z.strictObject({
  /** Stable per subject: `thread:<id>`, `action:<id>`, `work:<id>`, `machine:<line>`. */
  key: z.string().min(1),
  group: noticeGroupSchema,
  /** Monotonic per key: a card re-raises only when the revision moves. */
  revision: z.int().min(0),
  /** The one word that says what the row is: asks, approve, running, failed, done, machine… */
  verb: z.string().min(1),
  what: z.string(),
  where: z.string(),
  /** The row's own sentence: the ask, the error, the outcome. Null is an honest nothing. */
  says: z.string().nullable(),
  at: z.string().nullable(),
  /** The resource address; null is an explicit refusal to invent one. */
  url: z.string().nullable(),
  refusal: z.string().optional(),
  /** The raw failure text `says` folds; the row offers it to copy. */
  detail: z.string().optional(),
  act: noticeActSchema.optional(),
  /** Only in the tray follower's feed: a person is looking at this row's thread now, so no card. */
  attended: z.literal(true).optional(),
});
export type NoticeRow = z.infer<typeof noticeRowSchema>;

/**
 * The `notices` Reading's snapshot. Rows arrive sorted group order first, newest first inside a
 * group. `id` is the host log id the snapshot was built at: a follower that raised cards up to it
 * raises nothing again, and a `gap` below it owes nothing earlier.
 */
export const noticeFeedSchema = z.strictObject({
  id: z.int().min(0),
  rows: z.array(noticeRowSchema),
  /** Whether the tray follows: a web surface raises an OS notification only when none does. */
  tray: z.boolean(),
});
export type NoticeFeed = z.infer<typeof noticeFeedSchema>;

/** The rows of one group, in feed order. */
export const noticeRows = (feed: NoticeFeed, group: NoticeGroup) =>
  feed.rows.filter((row) => row.group === group);

/** Every open consent window in the feed: what the topbar sweep and the tray card draw. */
export const consentWindows = (feed: NoticeFeed) =>
  feed.rows.flatMap((row) => (row.act?.kind === "consent" ? [{ row, act: row.act }] : []));
