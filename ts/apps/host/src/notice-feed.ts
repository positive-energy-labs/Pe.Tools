/**
 * The one notice feed (ADR 0035 rule 7): the host's `notices` Reading serves a `NoticeFeed`, every
 * row that needs a person or tells one what happened, grouped waits, working, interrupted, failed,
 * unread. Push (the tray card, the OS notification) and pull (home and tray Activity, Mod+Shift+K)
 * read these rows; nothing else projects receipts into cards or joins threads in the browser.
 * Sources, all host-owned: thread summaries and each waiting thread's open ask, action receipts,
 * Works with staged edits, the Machine's attention lines, and the machine's stored-file notices
 * (ADR 0039: one durable line per stored file that did not decode).
 *
 * Plain functions, not Effect: this sits beside the thread store's Readings in the
 * `observeHostResource` island (ADR 0029 phase 5 converts them together).
 */
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import {
  attention,
  invocationOutcome,
  NOTICE_GROUPS,
  readingKey,
  routeAddress,
  type ActionReceipt,
  type HarnessEvent,
  type HarnessThreadSummary,
  type Machine,
  type NavigationWork,
  type NoticeAct,
  type NoticeFeed,
  type NoticeRow,
  type ReadingFrame,
  type ReadingRequest,
} from "@pe/agent-contracts";
import { HOST_RESTARTED } from "@pe/agent-contracts/chat-state";
import { summarizeFailure } from "@pe/host-contracts/failure-summary";
import type { ThreadPresence } from "@pe/host-contracts/pe-api";
import { noFirmHomeText, type FirmHome } from "@pe/host-contracts/product-paths";
import { note, sha256Hex, type StoredNotice, type StateRoot } from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";

/** The Place a no-firm-home notice is filed under; its row is a finding, not a file that did not decode. */
const FIRM_HOME_PLACE = "Firm home";
const EARLIER_WORK_PLACE = "Work saved by an earlier version";
/** A setting saved at a home tier (homes MAP slice 6b): the row says what happened; nothing was refused. */
export const SETTING_WRITE_PLACE = "Setting saved";

async function holdsFileAsync(path: string): Promise<boolean> {
  for await (const entry of await opendir(path))
    if (entry.isFile() || (entry.isDirectory() && (await holdsFileAsync(join(path, entry.name)))))
      return true;
  return false;
}

/** Run after the async home census; old Work is noticed without blocking requests. */
export async function noteEarlierWork(
  user: string,
  machine: StateRoot = hostState(),
): Promise<void> {
  const path = join(user, "Work");
  try {
    if (await holdsFileAsync(path)) noteEarlierWorkFinding(path, machine);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      console.warn(`Could not check earlier Work at '${path}': ${String(error)}`);
  }
}

function noteEarlierWorkFinding(path: string, machine: StateRoot) {
  note(machine, {
    class: "keep",
    place: EARLIER_WORK_PLACE,
    path,
    sha256: sha256Hex("earlier-version-work-folder"),
    reason: `Work saved by an earlier version is at ${path}. This version no longer reads it. Nothing was changed or deleted. You may delete the folder.`,
  });
}

/**
 * Tell a person once to set their firm home in Settings. Repeated starts de-duplicate the notice.
 */
export function noteNoFirmHome(firm: FirmHome, machine: StateRoot = hostState()): void {
  const places = firm.looked;
  if (firm.root || !places.length) return;
  const reason = noFirmHomeText(firm);
  note(machine, {
    class: "keep",
    place: FIRM_HOME_PLACE,
    path: places[0]!,
    sha256: sha256Hex(reason),
    reason,
  });
}

/**
 * A row as built. Its revision is its source's own durable counter (a thread's last seq, a
 * receipt's revision, a Work's revision), so a host restart moves no revision and raises no card.
 */
export type NoticeDraft = Omit<NoticeRow, "attended">;

export interface NoticeSources {
  readonly threads: readonly (HarnessThreadSummary & {
    readonly events: readonly HarnessEvent[];
  })[];
  /** Action receipts with their envelope's revision. */
  readonly receipts: readonly { readonly revision: number; readonly action: ActionReceipt }[];
  readonly works: readonly NavigationWork[];
  readonly machine: Machine | null;
  /** `notices(machine)`: files refused as kept or discarded. */
  readonly stored: readonly StoredNotice[];
  /** False clears the live warning after the roots owner recovers; the durable audit remains. */
  readonly firmHomeUnavailable?: boolean;
}

/** A host-restart death leaves the feed after this long; Pea's thread list still holds it. */
const INTERRUPTED_FOR_MS = 24 * 3_600_000;
/** A held act leaves the feed after this long; its receipt still holds it. */
const HELD_FOR_MS = 24 * 3_600_000;

/** A waiting thread's open ask, in its own words, and the door that answers it. */
function openAsk(
  threadId: string,
  events: readonly HarnessEvent[],
): { verb: string; says: string; act: NoticeAct } | null {
  const resolved = new Set(
    events.flatMap((e) => (e.kind === "question_resolved" ? [e.requestId] : [])),
  );
  const open = events.findLast((e) => e.kind === "question_request" && !resolved.has(e.requestId));
  if (open?.kind === "question_request")
    return {
      verb: "asks",
      says: open.message,
      act: {
        kind: "question",
        threadId,
        requestId: open.requestId,
        requestedSchema: open.requestedSchema as Record<string, unknown>,
      },
    };
  return null;
}

/** Pea's words in the thread's last turn: what an unread row says. */
function lastSaid(events: readonly HarnessEvent[]): string | null {
  const turn = events.findLast((e) => e.kind === "prompt")?.turnId;
  const text = events
    .flatMap((e) =>
      e.kind === "update" && e.turnId === turn && e.update.sessionUpdate === "agent_message_chunk"
        ? [(e.update as { content?: { type?: string; text?: string } }).content]
        : [],
    )
    .map((content) => (content?.type === "text" ? (content.text ?? "") : ""))
    .join("")
    .trim();
  return text || null;
}

function threadRow(thread: NoticeSources["threads"][number], now: number): NoticeDraft | null {
  const { state, pending, message } = thread.activity;
  const row = (group: NoticeDraft["group"], verb: string, says: string | null): NoticeDraft => ({
    key: `thread:${thread.id}`,
    group,
    revision: thread.lastSeq,
    verb,
    what: thread.title,
    where: thread.providerName,
    says,
    at: thread.updatedAt,
    url: routeAddress("chat").link({}, { thread: thread.id }),
  });
  if (state === "waiting" || pending > 0) {
    const ask = openAsk(thread.id, thread.events);
    return ask
      ? { ...row("waits", ask.verb, ask.says), act: ask.act }
      : row("waits", "asks", message);
  }
  if (state === "running") return row("working", "running", null);
  if (state === "failed" && message === HOST_RESTARTED)
    return now - Date.parse(thread.updatedAt) > INTERRUPTED_FOR_MS
      ? null
      : {
          ...row("interrupted", "interrupted", "The host restarted during this turn."),
          act: { kind: "resume", threadId: thread.id },
        };
  if (state === "failed") {
    const failure = summarizeFailure(message ?? "The turn failed.");
    // A harness that died keeps its stderr on the error event; that is the raw detail.
    const ended = thread.events.findLast((e) => e.kind === "error");
    const raw = ended?.kind === "error" ? ended.failure?.raw : undefined;
    const detail = raw || failure.detail;
    return { ...row("failed", "failed", failure.summary), ...(detail ? { detail } : {}) };
  }
  const unread = thread.lifecycle.explicitUnread || thread.lifecycle.readSeq < thread.lastSeq;
  return unread && thread.lastSeq > 0
    ? {
        ...row("unread", "done", lastSaid(thread.events)),
        act: { kind: "reply", threadId: thread.id },
      }
    : null;
}

/** A stored-file notice leaves the feed after this long; its line stays, so it is never posted twice. */
const STORED_FOR_MS = 7 * 24 * 3_600_000;

/** A file that did not decode: discarded, or "can't read, kept" (ADR 0039 rule 1). */
function storedRow(
  notice: StoredNotice,
  now: number,
  firmHomeUnavailable?: boolean,
): NoticeDraft | null {
  if (
    firmHomeUnavailable === false &&
    notice.place === FIRM_HOME_PLACE &&
    notice.reason.startsWith("Firm home unavailable at ")
  )
    return null;
  // ponytail: a fixed window and no dismiss door; add a dismiss act when a person asks for one.
  if (now - Date.parse(notice.at) > STORED_FOR_MS) return null;
  if (notice.class === "sent")
    return {
      key: `stored:${notice.path}:${notice.sha256}`,
      group: "unread",
      revision: 0,
      verb: "sent",
      what: notice.path,
      where: notice.place,
      says: notice.reason,
      at: notice.at,
      url: null,
    };
  const kept = notice.class === "keep";
  if (notice.place === EARLIER_WORK_PLACE)
    return {
      key: `stored:${notice.path}:${notice.sha256}`,
      group: "failed",
      revision: 0,
      verb: "kept",
      what: notice.place,
      where: "this computer",
      says: notice.reason,
      at: notice.at,
      url: null,
      refusal: "This version no longer reads this folder",
      detail: notice.path,
    };
  if (notice.place === SETTING_WRITE_PLACE)
    return {
      key: `stored:${notice.path}:${notice.sha256}`,
      group: "unread",
      revision: 0,
      verb: "saved",
      what: notice.place,
      where: notice.path,
      // The reason carries the writer and prior bytes; detail links the saved action.
      says: notice.reason,
      at: notice.at,
      url: routeAddress("settings").link(),
      detail: notice.reason.match(/Receipt [^.]+\./)?.[0],
      visibleDetail: notice.reason.match(/Receipt [^.]+\./)?.[0],
    };
  if (notice.place === FIRM_HOME_PLACE)
    return {
      key: `stored:${notice.path}:${notice.sha256}`,
      group: "failed",
      revision: 0,
      verb: "not found",
      what: notice.place,
      where: "this computer",
      says: notice.reason,
      at: notice.at,
      url: null,
      refusal:
        "Nothing to open: firm Pods, Pages, Catalogs, Settings and keys are off until it is found",
      detail: notice.reason,
    };
  return {
    key:
      `stored:${notice.path}:${notice.sha256}` +
      (notice.documentKey ? ":" + notice.documentKey : ""),
    group: "failed",
    // A model recovery identifies the document as well as the shared backup.
    revision: 0,
    verb: kept ? "kept" : "discarded",
    what: notice.place,
    where: "this computer",
    says: notice.documentKey
      ? notice.reason
      : kept
        ? `Can't read, kept: ${notice.reason}`
        : `Could not be read, so it was discarded: ${notice.reason}`,
    at: notice.at,
    url: null,
    refusal: notice.documentKey
      ? undefined
      : kept
        ? "No address yet: fix or remove the file by hand"
        : "Nothing to open: the file is gone",
    detail: notice.path,
  };
}

/** Who admitted the action, in words: a principal, never a password. */
const callerWord = (caller: ActionReceipt["caller"]) =>
  caller.kind === "pea"
    ? "Pea"
    : caller.kind === "page"
      ? "a Page"
      : caller.kind === "external-mcp"
        ? caller.label
        : caller.kind;

const RECEIPT_GROUP: Partial<Record<ActionReceipt["state"], NoticeDraft["group"]>> = {
  unknown: "waits",
  incomplete: "waits",
  running: "working",
  failed: "failed",
};

function receiptRow(
  { revision, action: receipt }: NoticeSources["receipts"][number],
  now: number,
): NoticeDraft | null {
  const pin = receipt.basis?.kind === "person-pin" ? receipt.basis : null;
  const who = pin ? `Page ${pin.page}, as the person who pinned it` : callerWord(receipt.caller);
  // A held act (ADR 0038) is one row that waits on the person, in its own words, never a failure.
  // A held send's one row is its `held` source, which carries Confirm; its receipt adds no second.
  const resultHeld =
    receipt.state === "succeeded" &&
    "result" in receipt &&
    receipt.result &&
    typeof receipt.result === "object" &&
    "held" in receipt.result &&
    typeof receipt.result.held === "string"
      ? receipt.result.held
      : null;
  const heldRefusal = receipt.refusal?.kind === "held" ? receipt.refusal : null;
  if (heldRefusal || resultHeld)
    return now - Date.parse(receipt.startedAt) > HELD_FOR_MS
      ? null
      : {
          key: `action:${receipt.id}`,
          group: "waits",
          revision,
          verb: "held",
          what: receipt.key,
          where: who,
          says: resultHeld ?? heldRefusal!.message,
          at: receipt.startedAt,
          url: null,
          refusal: "Nothing to open: do this in Revit or the web app yourself",
        };
  // A known refusal is not a human hold and reads as stale or refused, with its reason. An incomplete act
  // whose last step was refused still waits on the person, because its earlier steps changed
  // something (an acquisition's local copies) that needs cleanup before it runs again.
  const last = receipt.steps?.at(-1);
  const refusedTail =
    receipt.state === "incomplete" && last?.state === "failed" && last.notDispatched === true;
  const refused = (receipt.state === "failed" && receipt.notDispatched === true) || refusedTail;
  const result = receipt.key === "instances.cleanup" && "result" in receipt ? receipt.result : null;
  const kept =
    result && typeof result === "object" && "kept" in result && Array.isArray(result.kept)
      ? result.kept.filter((path): path is string => typeof path === "string")
      : [];
  const group = RECEIPT_GROUP[receipt.state] ?? (kept.length || pin ? "unread" : undefined);
  if (!group) return null;
  const failure =
    "error" in receipt
      ? summarizeFailure(receipt.error)
      : {
          summary:
            receipt.state === "succeeded"
              ? pin
                ? "Finished on the document this person pinned."
                : "Cleanup finished with kept files."
              : "The outcome is not known. Check Revit before running it again.",
          door: null,
          detail: null,
        };
  return {
    key: `action:${receipt.id}`,
    group,
    revision,
    verb: refused
      ? invocationOutcome(receipt).state === "stale"
        ? "stale"
        : "refused"
      : receipt.state,
    what: receipt.key,
    where: who,
    says: `${refused && "error" in receipt ? receipt.error : failure.summary}${refusedTail ? " Earlier steps already changed something; clean up before running it again." : ""}`,
    at: receipt.startedAt,
    // The failure's door is the row's address; a receipt itself has no page yet.
    url: failure.door
      ? `${routeAddress("settings").link({ section: failure.door.section })}${failure.door.hash ? `#${failure.door.hash}` : ""}`
      : null,
    ...(failure.door ? {} : { refusal: "No address yet: this receipt has no page" }),
    ...(failure.detail || kept.length
      ? {
          detail: [failure.detail, kept.length ? `kept: ${kept.join(", ")}` : null]
            .filter(Boolean)
            .join("\n"),
        }
      : {}),
  };
}

function nativeTouchedRows(receipt: ActionReceipt): NoticeDraft[] {
  return receipt.steps.flatMap((step): NoticeDraft[] => {
    if ((step.transport !== "bridge" && !("opReceipt" in step)) || step.state === "running")
      return [];
    if (
      step.transport === "bridge" &&
      !step.touched &&
      (step.bridgeReply === "missing-touched" || step.bridgeReply === "invalid-touched")
    )
      return [
        {
          key: `native:${step.id}`,
          group: "failed" as const,
          revision: 0,
          verb: step.bridgeReply,
          what: step.key,
          where: callerWord(receipt.caller),
          says:
            step.bridgeReply === "missing-touched"
              ? "Revit answered without a touched value. Its document changes were not reported."
              : "Revit answered with an invalid touched value. Its document changes could not be decoded.",
          at: receipt.startedAt,
          url: null,
          refusal: "No address yet: this receipt has no page",
        },
      ];
    if (!step.touched || !["restoreFailed", "unauthorized", "unknown"].includes(step.touched.kind))
      return [];
    const touched = step.touched;
    return [
      {
        // One card per native step, even when the parent receipt advances after its terminal.
        key: `native:${step.id}`,
        group: "failed" as const,
        revision: 0,
        verb: touched.kind,
        what: step.key,
        where: callerWord(receipt.caller),
        says:
          touched.kind === "restoreFailed"
            ? "Revit could not restore the captured view. Check its view settings."
            : touched.kind === "unauthorized"
              ? "Revit changed the document outside the permitted scope."
              : touched.kind === "unknown" && touched.reason === "process-exit"
                ? "Revit exited before answering. It may have changed the model; the outcome is unknown."
                : "The native call's changes are unknown. Check Revit before running it again.",
        detail: JSON.stringify(touched),
        at: receipt.startedAt,
        url: null,
        refusal: "No address yet: this receipt has no page",
      },
    ];
  });
}

/** Every row, group order first (waits and working lead), newest first inside a group. */
export function noticeRows(sources: NoticeSources, now: number): NoticeDraft[] {
  const rows: NoticeDraft[] = [
    ...(sources.machine ? attention(sources.machine) : []).map((line) => ({
      key: `machine:${line}`,
      group: "waits" as const,
      // The line is the key: a line that clears and returns is a new row.
      revision: 0,
      verb: "machine",
      what: line,
      where: "this computer",
      says: null,
      at: null,
      url: routeAddress("settings").link(),
    })),
    ...sources.threads
      .filter((thread) => thread.lifecycle.status === "active")
      .flatMap((thread) => threadRow(thread, now) ?? []),
    ...sources.receipts.flatMap((receipt) => {
      const parent = receiptRow(receipt, now);
      return [...(parent ? [parent] : []), ...nativeTouchedRows(receipt.action)];
    }),
    ...sources.stored.flatMap(
      (notice) => storedRow(notice, now, sources.firmHomeUnavailable) ?? [],
    ),
    // Staged Work includes human edits and scope choices; it carries no proposal-actor count.
    ...sources.works
      .filter((work) => work.staged > 0)
      .map((work) => ({
        key: `work:${work.id}`,
        group: "waits" as const,
        revision: work.revision ?? 0,
        verb: "review",
        what: work.label,
        where: work.context,
        says: `${work.staged} staged change${work.staged === 1 ? "" : "s"} to review`,
        at: null,
        url: work.url,
        ...(work.url ? {} : { refusal: work.reason ?? "No resumable destination" }),
      })),
  ];
  return rows.sort(
    (a, b) =>
      NOTICE_GROUPS.indexOf(a.group) - NOTICE_GROUPS.indexOf(b.group) ||
      (b.at ?? "").localeCompare(a.at ?? ""),
  );
}

export interface NoticeFeedDeps {
  /** The rows now, from the host's own stores, and the host log id they were read at. */
  readonly build: () => { readonly id: number; readonly rows: readonly NoticeDraft[] };
  /** Fires whenever any source moved; the feed is rebuilt and published once per change. */
  readonly subscribe: (changed: () => void) => () => void;
}

export interface NoticeFeedReading {
  /** Serves `{ kind: "notices" }`; any other request is not this Reading's (undefined). */
  observe(
    request: ReadingRequest,
    publish: (frame: ReadingFrame) => void,
    after?: number | null,
  ): (() => void) | undefined;
  /** A surface's presence on a thread: a row for a thread someone is looking at is `attended`. */
  beat(caller: string, value: ThreadPresence): void;
  close(): void;
}

/** A presence beat lapses after this long without another. */
const BEAT_MS = 10_000;
/** Source changes inside this window build one feed. */
const SETTLE_MS = 50;

const threadOf = (row: NoticeRow) =>
  row.act && "threadId" in row.act
    ? row.act.threadId
    : row.key.startsWith("thread:")
      ? row.key.slice(7)
      : undefined;

export function createNoticeFeed(deps: NoticeFeedDeps): NoticeFeedReading {
  const followers = new Set<{ tray: boolean; send: (feed: NoticeFeed) => void }>();
  const beats = new Map<string, ThreadPresence & { at: number }>();
  let feed: ReturnType<NoticeFeedDeps["build"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The sources are watched only while someone follows; the last to leave lets them go. */
  let unsubscribe: (() => void) | undefined;
  const trays = () => [...followers].filter((follower) => follower.tray).length;
  /** Threads someone is looking at; a beat older than BEAT_MS is gone (expired on read). */
  const looking = () => {
    const now = Date.now();
    for (const [caller, beat] of beats) if (now - beat.at >= BEAT_MS) beats.delete(caller);
    return new Set([...beats.values()].map((beat) => beat.thread));
  };
  function publish(only?: "tray") {
    if (!followers.size) return;
    feed ??= deps.build();
    const { id, rows } = feed;
    const attended = looking();
    const tray = trays() > 0;
    for (const follower of followers) {
      if (only && !follower.tray) continue;
      follower.send({
        id,
        rows: rows.map((row) => {
          const thread = follower.tray ? threadOf(row) : undefined;
          return thread && attended.has(thread) ? { ...row, attended: true as const } : row;
        }),
        tray,
      });
    }
  }
  const changed = () => {
    // ponytail: a 50 ms settle, so a turn's end (its events, then its receipts) builds one feed.
    timer ??= setTimeout(() => {
      timer = undefined;
      feed = deps.build();
      publish();
    }, SETTLE_MS);
  };
  const release = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    clearTimeout(timer);
    timer = undefined;
    feed = undefined;
  };

  return {
    observe(request, publish_, _after) {
      // A snapshot is the whole feed: there is nothing to replay from a cursor.
      if (request.kind !== "notices") return undefined;
      const key = readingKey(request);
      let last = "";
      const follower = {
        tray: request.as === "tray",
        send: (value: NoticeFeed) => {
          // Beats and rebuilds that change nothing this follower sees send nothing.
          const frame = JSON.stringify(value);
          if (frame === last) return;
          last = frame;
          publish_({ kind: "snapshot", key, value });
        },
      };
      followers.add(follower);
      unsubscribe ??= deps.subscribe(changed);
      // A tray arriving changes every follower's `tray`; anyone else gets only its own first frame.
      if (follower.tray) publish();
      else {
        feed ??= deps.build();
        follower.send({ id: feed.id, rows: [...feed.rows], tray: trays() > 0 });
      }
      return () => {
        followers.delete(follower);
        if (!followers.size) release();
        else if (follower.tray) publish();
      };
    },
    beat(caller, value) {
      if (value.visible && value.focused) beats.set(caller, { ...value, at: Date.now() });
      else beats.delete(caller);
      publish("tray");
    },
    close() {
      release();
      followers.clear();
    },
  };
}
