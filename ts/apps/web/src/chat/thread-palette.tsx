import { threadSearchDefault } from "@pe/agent-contracts";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  GitFork,
  Hand,
  LoaderCircle,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  SquarePen,
  Timer,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  routeAddress,
  routeAt,
  type DocumentRequest,
  type Provider,
  type UpdateThreadRequest,
} from "@pe/agent-contracts";
import { Dialog, DialogContent, DialogTitle } from "@pe/kit/lang/dialog";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { Input } from "@pe/kit/lang/input";
import { useList, type ListState, type ListPersist } from "@pe/kit/lang/collection";
import { Scroll } from "@pe/kit/lang/scroll";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { Button } from "@pe/kit/lang/button";
import { Pane } from "@pe/kit/lang/pane";
import { Switcher } from "@pe/kit/lang/switcher";
import { MODE_HINT, MODES, type Mode } from "#/workbench/depth";
import { ProviderMark } from "#/components/lang/provider-mark";
import { useSurfaceHost } from "#/navigation/surface-host";
import { peClient } from "#/host/pe-client";
import { readPeError } from "@pe/host-contracts/pe-api";
import "./thread-navigation.css";
import "#/components/lang/navigation.css";
import type { StoredThreadSummary } from "#/workbench/provider";
import { isReady } from "#/workbench/provider/providers";
import {
  isUnread,
  shelfOf,
  relativeThreadAge,
  threadOrder,
  activityWord,
  wokeFromSnooze,
  compareThreads,
  inAttention,
  threadActivity,
  threadSearchText,
  THREAD_STATES,
  THREAD_SHELVES as SHELF_ORDER,
  oneThreadRefusal,
  soleRequest,
  threadActions,
  type ThreadActivity,
  type ThreadShelf,
  type TargetRead,
  type ThreadAction,
} from "./thread-navigation";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { chipRecipe } from "@pe/kit/lang/chip";
import type { ThreadWork } from "@pe/agent-contracts";
import {
  documentsLabel,
  leadWork,
  partialWork,
  resumeWork,
  useThreadWorks,
  workHint,
} from "./thread-work";

/** What the roster holds: stored summaries, read against the live inventory by the shell. */
type RosterThread = StoredThreadSummary & TargetRead;

interface ThreadVerbs {
  providers: Provider[];
  onFork: (id: string, providerId?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, change: UpdateThreadRequest) => Promise<boolean>;
  onNewTarget: (target: DocumentRequest | null) => void;
}
type Action = {
  id: string;
  label: string;
  /** A computed fact beside the verb (a wake time, the current policy). */
  sub?: string;
  /** The fact is a reading (a clock time), drawn as one; otherwise it is a word. */
  reading?: boolean;
  icon?: LucideIcon;
  /** The verb cluster; blank-space names draw as rules between clusters (`RowGroupHead`). */
  group?: string;
  refusal?: string;
  /** The current choice inside a drill-in (the auto-settle policy in force). */
  active?: boolean;
  run?: () => void;
  /** A drill-in: picking the row walks the ladder to these. */
  children?: Action[];
};

/** T3's snooze presets in local calendar time: 1 h, 3 h, this evening (when > 1 h away),
 *  tomorrow 9 AM, next Monday 9 AM (dropped when it is tomorrow). */
function snoozePresets(now = new Date()): { id: string; label: string; at: Date }[] {
  const at = (days: number, hour: number) => {
    const day = new Date(now);
    day.setDate(day.getDate() + days);
    day.setHours(hour, 0, 0, 0);
    return day;
  };
  const evening = at(0, 18);
  const tomorrow = at(1, 9);
  const monday = at((8 - now.getDay()) % 7 || 7, 9);
  return [
    { id: "1h", label: "In 1 hour", at: new Date(now.getTime() + 3_600_000) },
    { id: "3h", label: "In 3 hours", at: new Date(now.getTime() + 3 * 3_600_000) },
    ...(evening.getTime() - now.getTime() > 3_600_000
      ? [{ id: "evening", label: "This evening", at: evening }]
      : []),
    { id: "tomorrow", label: "Tomorrow", at: tomorrow },
    ...(monday.getTime() !== tomorrow.getTime()
      ? [{ id: "week", label: "Next week", at: monday }]
      : []),
  ];
}

/** A wake time as a person says it: the time today, else the weekday and time. */
function wakeLabel(at: Date, now = new Date()): string {
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function ThreadActionsMenu({
  thread,
  open,
  setOpen,
  selection,
  onMany,
  ...verbs
}: ThreadVerbs & {
  thread: RosterThread;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The selected threads when this row is one of several: the menu then acts on all of them. */
  selection?: RosterThread[];
  /** Applies a change to the targets of a many-thread verb, and reports "N of M threads changed". */
  onMany?: (
    targets: RosterThread[],
    change: (thread: RosterThread) => UpdateThreadRequest,
    of: number,
  ) => void;
}) {
  const [form, setForm] = useState<"rename" | "delete" | "snooze" | null>(null);
  const [title, setTitle] = useState(thread.title);
  const [wake, setWake] = useState("");
  const [failure, setFailure] = useState("");
  const busy = thread.activity.state === "running" || thread.activity.pending > 0;
  // The menu opened on a selected row acts on the whole selection; verbs that cannot stay
  // listed and refuse with the reason.
  const group = selection && selection.length > 1 ? selection : [thread];
  const count = group.length;
  const apply = (
    verb: ThreadAction<RosterThread>,
    change: (thread: RosterThread) => UpdateThreadRequest = verb.change!,
  ) =>
    count > 1
      ? onMany?.(verb.targets, change, count)
      : void verbs.onUpdate(thread.id, change(thread));
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).catch(() => setFailure(`Could not copy the ${what}`));
  const lifecycle = thread.lifecycle;
  // Built when the menu opens: 100+ closed rows must not each compute presets and wake labels.
  const buildActions = (): Action[] => {
    const forks = verbs.providers.filter(isReady);
    const now = new Date();
    const plan = threadActions(group);
    const verbOf = (id: ThreadAction["id"]) => plan.find((verb) => verb.id === id)!;
    const lifecycleAction = (
      id: ThreadAction["id"],
      icon: LucideIcon,
      groupName?: string,
    ): Action => {
      const verb = verbOf(id);
      return {
        id: verb.id,
        label: verb.label,
        sub:
          verb.note ??
          (verb.label === "Wake now" && count === 1 && lifecycle.snoozedUntil
            ? `snoozed until ${wakeLabel(new Date(lifecycle.snoozedUntil), now)}`
            : undefined),
        icon,
        group: groupName,
        refusal: verb.refusal,
        run: () => apply(verb),
      };
    };
    const snooze = verbOf("snooze");
    const pinIcon = verbOf("pin").label === "Unpin" ? PinOff : Pin;
    const settleIcon = verbOf("settle").label === "Reopen" ? RotateCcw : CircleCheck;
    const unreadIcon = verbOf("unread").label === "Mark read" ? MailOpen : Mail;
    const archiveIcon = verbOf("archive").label === "Restore" ? ArchiveRestore : Archive;
    return [
      lifecycleAction("pin", pinIcon),
      lifecycleAction("settle", settleIcon),
      snooze.label === "Wake now"
        ? lifecycleAction("snooze", AlarmClockOff)
        : {
            id: "snooze",
            label: "Snooze",
            sub: snooze.note,
            icon: AlarmClock,
            refusal: snooze.refusal,
            children: [
              ...snoozePresets(now).map((preset) => ({
                id: `snooze:${preset.id}`,
                label: preset.label,
                sub: wakeLabel(preset.at, now),
                reading: true,
                run: () => apply(snooze, () => ({ snoozedUntil: preset.at.toISOString() })),
              })),
              { id: "snooze:custom", label: "Custom…", run: () => setForm("snooze") },
            ],
          },
      lifecycleAction("unread", unreadIcon, " "),
      {
        id: "rename",
        label: "Rename…",
        icon: Pencil,
        group: " ",
        refusal: oneThreadRefusal("Rename", count),
        run: () => {
          setTitle(thread.title);
          setForm("rename");
        },
      },
      ...(soleRequest(thread.head)
        ? [
            {
              id: "new-target",
              label: "New thread on this target",
              icon: SquarePen,
              group: " ",
              refusal: oneThreadRefusal("New thread", count) ?? verbOf("new-target").refusal,
              run: () => verbs.onNewTarget(soleRequest(thread.head)),
            },
          ]
        : []),
      ...(forks.length
        ? [
            {
              id: "fork",
              label: "Fork",
              icon: GitFork,
              group: " ",
              refusal:
                oneThreadRefusal("Fork", count) ??
                (busy ? "wait for the turn to finish" : undefined),
              children: forks.map((provider) => ({
                id: `fork:${provider.id}`,
                label: provider.name,
                run: () => verbs.onFork(thread.id, provider.id),
              })),
            },
          ]
        : []),
      {
        id: "export",
        label: "Download transcript",
        icon: Download,
        group: "  ",
        refusal: oneThreadRefusal("Export", count),
        run: () => {
          void (async () => {
            const response = await peClient.response("thread.export", {
              params: { id: thread.id },
            });
            if (!response.ok) throw Error((await readPeError(response)).message);
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            link.download =
              /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
              `${thread.id}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })().catch((error: unknown) =>
            setFailure(error instanceof Error ? error.message : "Could not export this thread"),
          );
        },
      },
      {
        id: "copy",
        label: "Copy",
        icon: Copy,
        group: "  ",
        refusal: oneThreadRefusal("Copy", count),
        children: [
          {
            id: "copy:link",
            label: "Thread link",
            run: () => {
              const url = new URL(location.href);
              const at = routeAddress(routeAt(url.pathname) ?? "pea");
              const { page, carry } = at.read(Object.fromEntries(url.searchParams));
              copy(
                new URL(at.link(page, { ...carry, thread: thread.id }), url.origin).href,
                "thread link",
              );
            },
          },
          {
            id: "copy:id",
            label: "Thread id",
            sub: thread.id,
            reading: true,
            run: () => copy(thread.id, "thread id"),
          },
          ...(soleRequest(thread.head)
            ? [
                {
                  id: "copy:target",
                  label: "Exact target",
                  run: () => copy(JSON.stringify(soleRequest(thread.head)), "target"),
                },
              ]
            : []),
        ],
      },
      {
        id: "auto",
        label: "Auto-settle",
        sub:
          count > 1
            ? undefined
            : lifecycle.autoSettle === "manual"
              ? "manual only"
              : `after ${lifecycle.autoSettle === "1d" ? "1 day" : "7 days"} idle`,
        icon: Timer,
        group: "  ",
        refusal: oneThreadRefusal("Auto-settle", count),
        children: (["manual", "1d", "7d"] as const).map((policy) => ({
          id: `auto:${policy}`,
          label:
            policy === "manual"
              ? "Manual only"
              : `After ${policy === "1d" ? "1 day" : "7 days"} of inactivity`,
          active: lifecycle.autoSettle === policy,
          run: () => void verbs.onUpdate(thread.id, { autoSettle: policy }),
        })),
      },
      lifecycleAction("archive", archiveIcon, "   "),
      {
        id: "delete",
        label: "Delete permanently…",
        icon: Trash2,
        group: "   ",
        refusal: oneThreadRefusal("Delete", count) ?? (busy ? "finish the work first" : undefined),
        run: () => setForm("delete"),
      },
    ];
  };
  // One line per verb (T3): its computed fact (a wake time, the policy, the target) trails on
  // the right, then the drill-in chevron.
  const actionRow = (item: Action) => ({
    lead: item.icon ? <item.icon aria-hidden /> : undefined,
    label: item.label,
    refusal: item.refusal,
    active: item.active,
    title: item.sub,
    meta:
      item.sub || item.children ? (
        <span className="inline-flex items-center gap-1">
          {item.sub ? (
            <span className="max-w-40 truncate" data-fact={item.reading ? undefined : "word"}>
              {item.sub}
            </span>
          ) : null}
          {item.children ? <ChevronRight aria-hidden className="size-3.5" /> : null}
        </span>
      ) : undefined,
  });
  return (
    <>
      {failure && !form ? (
        <span role="status" data-tone="caution">
          {failure}
        </span>
      ) : null}
      <ListPopup<Action>
        anchor="trigger"
        face="icon"
        trigger={<MoreHorizontal />}
        triggerLabel={`Actions for ${thread.title}`}
        open={open}
        onOpenChange={setOpen}
        aria-label="Thread actions"
        // The kit's ladder is the submenu (R12): a cluster row walks in, Esc walks back out.
        levels={[
          {
            label: "",
            items: buildActions,
            onPick: (item) => {
              if (item.children) return;
              setOpen(false);
              item.run?.();
            },
          },
          { label: "", items: (path) => path[0]?.children ?? [] },
        ]}
        keyOf={(item) => item.id}
        labelOf={(item) => item.label}
        groupOf={(item) => item.group}
        groupCounts={false}
        empty="No actions"
        maxHeight="28rem"
        onPick={(item) => item.run?.()}
        row={actionRow}
      />
      <Dialog
        open={form !== null}
        onOpenChange={(shown) => {
          if (!shown) {
            setForm(null);
            setFailure("");
          }
        }}
      >
        <DialogContent>
          <DialogTitle>
            {form === "rename"
              ? "Rename thread"
              : form === "snooze"
                ? "Snooze until…"
                : "Delete this thread permanently?"}
          </DialogTitle>
          <p>{count > 1 ? `${count} threads` : thread.title}</p>
          {form === "rename" ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim()) {
                  verbs.onRename(thread.id, title.trim());
                  setForm(null);
                }
              }}
            >
              <Input
                autoFocus
                aria-label="Thread title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
              />
              <Button
                type="submit"
                label="Save name"
                refusal={title.trim() ? null : "The thread needs a name before it can be saved."}
              >
                Save name
              </Button>
            </form>
          ) : form === "snooze" ? (
            <div className="flex flex-col gap-3">
              <Input
                type="datetime-local"
                aria-label="Custom wake time"
                value={wake}
                onChange={(event) => setWake(event.target.value)}
              />
              <Button
                label="Snooze until this time"
                onClick={() => {
                  const time = new Date(wake);
                  const pad = (value: number) => String(value).padStart(2, "0");
                  const local = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`;
                  if (
                    !wake ||
                    !Number.isFinite(time.getTime()) ||
                    time.getTime() <= Date.now() ||
                    local !== wake
                  ) {
                    setFailure(
                      "Choose a valid future local time; daylight-saving gaps cannot be scheduled",
                    );
                    return;
                  }
                  apply(threadActions(group).find((verb) => verb.id === "snooze")!, () => ({
                    snoozedUntil: time.toISOString(),
                  }));
                  setForm(null);
                }}
              >
                Snooze until this time
              </Button>
            </div>
          ) : (
            <>
              <p>Its conversation and saved history will be removed. Archive keeps them.</p>
              <div className="flex gap-3">
                <Button label="Keep thread" onClick={() => setForm(null)}>
                  Keep thread
                </Button>
                <Button
                  label="Delete permanently"
                  onClick={() => {
                    verbs.onDelete(thread.id);
                    setForm(null);
                  }}
                >
                  Delete permanently
                </Button>
              </div>
            </>
          )}
          {failure ? <p data-tone="caution">{failure}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// The row's own hover carries the exact time, targets and model (`rowHint`): one hover per row,
// not one per fact, so a keystroke in search re-renders rows, not a tooltip tree per cell.
function ThreadTime({ thread, now }: { thread: RosterThread; now: number }) {
  return <time dateTime={thread.updatedAt}>{relativeThreadAge(thread.updatedAt, now)}</time>;
}

const STAMP = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
// Names only: a session or open id never reaches the row, its hint included.
const rowHint = (thread: RosterThread, work: ThreadWork | undefined) =>
  [
    work ? workHint(work, thread.title) : thread.title,
    [thread.providerName, thread.modelId].filter(Boolean).join(" "),
    STAMP.format(new Date(thread.updatedAt)),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * A row's menu re-renders only when its data changes. The closures the sidebar mints per render
 * (`setOpen`, `onMany`) close over this row's thread and stable setters, so
 * they are not compared; the thread, the open flag, the selection and the verbs are.
 */
const ThreadActions = memo(ThreadActionsMenu, (before, after) => {
  const { setOpen: _a, onMany: _b, ...was } = before;
  const { setOpen: _d, onMany: _e, ...now } = after;
  const keys = Object.keys(was) as (keyof typeof was)[];
  return keys.length === Object.keys(now).length && keys.every((key) => was[key] === now[key]);
});

function CompactThreadTrail({ thread, now }: { thread: RosterThread; now: number }) {
  return (
    <span className="pe-thread-trail">
      <ThreadTime thread={thread} now={now} />
      <ProviderMark harness={thread.harness} />
    </span>
  );
}

export type ThreadSort = "recent" | "title";

function initialShelfState(current: RosterThread | undefined): ListState<ThreadSort> {
  const closed = SHELF_ORDER.filter((shelf) => {
    if (current && shelfOf(current) === shelf) return false;
    try {
      const saved = localStorage.getItem(`pe.shelf.${shelf}`);
      if (saved !== null) return saved !== "open";
    } catch {
      /* The list still works without storage. */
    }
    return shelf === "snoozed" || shelf === "settled" || shelf === "archived";
  }).map((shelf) => SHELF_WORD[shelf]);
  return { search: threadSearchDefault(), sort: "", closed, open: [], selected: [] };
}

function ThreadActivityMark({
  thread,
  now,
  woke,
}: {
  thread: RosterThread;
  now: number;
  woke: boolean;
}) {
  const shelf = shelfOf(thread, now);
  const activity = shelf === "snoozed" ? "snoozed" : threadActivity(thread);
  const Icon =
    activity === "snoozed"
      ? Clock3
      : activity === "working"
        ? LoaderCircle
        : activity === "waiting"
          ? Hand
          : activity === "failed"
            ? TriangleAlert
            : woke
              ? AlarmClock
              : null;
  const word =
    activity === "snoozed"
      ? wakeLabel(new Date(thread.lifecycle.snoozedUntil!), new Date(now))
      : (activityWord(thread) ?? (woke ? "Woke" : undefined));
  return word ? (
    <TooltipHint content={word}>
      <span
        data-slot="nav-state"
        data-tone={
          activity === "failed" ? "alarm" : activity === "waiting" || woke ? "caution" : undefined
        }
        role={Icon ? "img" : undefined}
        aria-label={Icon ? word : undefined}
      >
        {Icon ? (
          <Icon aria-hidden className={activity === "working" ? "animate-spin" : undefined} />
        ) : (
          word
        )}
      </span>
    </TooltipHint>
  ) : null;
}

const searchThread = (thread: RosterThread) => ({ text: [threadSearchText(thread)] });

export function ThreadsSidebar({
  threads,
  currentThreadId,
  onSelect,
  onWork,
  address,
  compactRows: compactRowsOverride,
  searchSerial = 0,
  reading = false,
  ...verbs
}: ThreadVerbs & {
  threads: RosterThread[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  /** A Work press opens its tool; the row's own press only opens the conversation. */
  onWork?: (id: string, route: string, link?: string) => void;
  compactRows?: boolean;
  address?: ListPersist<ThreadSort>;
  /** The page's own list: "/" outside a field lands in its search. */
  primary?: boolean;
  /** The roster has not been read yet: empty means unknown, not "no threads". */
  reading?: boolean;
  /** Bumped by Mod+K: focus this list's search (also on mount, for the narrow dialog). */
  searchSerial?: number;
}) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (searchSerial)
      navRef.current?.querySelector<HTMLInputElement>("[data-list-bar] input")?.focus();
  }, [searchSerial]);
  const host = useSurfaceHost();
  const works = useThreadWorks();
  const partial = partialWork(works.snapshot);
  // Why a closed Work could not resume, said once in its row's hint; the row stays pressable.
  const [unresumed, setUnresumed] = useState<ReadonlyMap<string, string>>(new Map());
  const pressWork = async (thread: string, work: ThreadWork, item: ThreadWork["works"][number]) => {
    const closed =
      work.documents.find((document) => document.id === item.documentId)?.availability === "closed";
    const resumed = closed ? await resumeWork(item.id) : null;
    if (resumed?.reason) setUnresumed((was) => new Map(was).set(thread, resumed.reason!));
    onWork?.(thread, item.route, resumed?.url ?? undefined);
  };
  const compactRows = compactRowsOverride ?? host.surface === "tray";
  const [view, setView] = useState(() =>
    initialShelfState(threads.find((thread) => thread.id === currentThreadId)),
  );
  const [now, setNow] = useState(Date.now);
  const previousThreads = useRef(new Map<string, RosterThread>());
  const [woken, setWoken] = useState<ReadonlySet<string>>(new Set());
  const wokenRef = useRef(woken);
  wokenRef.current = woken;
  useEffect(() => {
    // shortcut: wake marks survive only this sidebar mount, persist a wake reason if reloads must retain them.
    const priorThreads = previousThreads.current;
    const previous = wokenRef.current;
    const next = new Set<string>();
    for (const thread of threads) {
      if (
        thread.id !== currentThreadId &&
        shelfOf(thread, now) !== "snoozed" &&
        shelfOf(thread, now) !== "archived" &&
        (previous.has(thread.id) || wokeFromSnooze(priorThreads.get(thread.id), thread, now))
      )
        next.add(thread.id);
    }
    if (next.size !== previous.size || ![...next].every((id) => previous.has(id))) setWoken(next);
    previousThreads.current = new Map(threads.map((thread) => [thread.id, thread]));
  }, [threads, currentThreadId, now]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const currentShelf = threads.find((thread) => thread.id === currentThreadId);
  const currentShelfKey = currentShelf ? SHELF_WORD[shelfOf(currentShelf, now)] : undefined;
  useEffect(() => {
    if (currentShelfKey)
      setView((previous) => ({
        ...previous,
        closed: previous.closed.filter((key) => key !== currentShelfKey),
      }));
  }, [currentThreadId, currentShelfKey]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState("");
  const providers = useMemo(
    () => [...new Map(threads.map((thread) => [thread.providerId, thread.providerName])).entries()],
    [threads],
  );
  const orderedThreads = useMemo(
    () => [...threads].sort((a, b) => compareThreads(a, b, now)),
    [threads, now],
  );
  const list = useList<RosterThread, ThreadSort>({
    items: orderedThreads,
    persist: address,
    keyOf: (thread) => thread.id,
    search: searchThread,
    fields: {
      provider: {
        kind: "text",
        read: (thread) => thread.providerId,
        values: providers.map(([key]) => key),
        labels: new Map(providers),
      },
      state: {
        kind: "text",
        read: threadActivity,
        values: THREAD_STATES,
        labels: new Map(THREAD_STATES.map((key) => [key, STATE_WORD[key]])),
      },
      unread: {
        kind: "text",
        read: (thread) => (isUnread(thread) ? "yes" : "no"),
        values: ["yes"],
        labels: new Map([["yes", "Unread"]]),
      },
      scope: {
        kind: "text",
        read: (thread) => (shelfOf(thread, now) === "archived" ? "archived" : "all"),
        values: ["attention", "all", "archived"],
        labels: new Map([
          ["attention", "Attention"],
          ["all", "All"],
          ["archived", "Archived"],
        ]),
        match: (thread, value) =>
          value.toLowerCase() === "attention"
            ? inAttention(thread, now)
            : value.toLowerCase() === "all"
              ? thread.lifecycle.status !== "archived" || thread.id === currentThreadId
              : value.toLowerCase() === "archived" && thread.lifecycle.status === "archived",
      },
    },
    sorts: {
      recent: (thread) => -Date.parse(thread.updatedAt),
      title: (thread) => thread.title.toLocaleLowerCase(),
    },
    groups: {
      of: (thread) => SHELF_WORD[shelfOf(thread, now)],
      order: SHELF_ORDER.map((key) => SHELF_WORD[key]),
    },
    select: "multi",
    state: view,
    onState: (next) => {
      setView(next);
      if (next.closed !== view.closed)
        for (const shelf of SHELF_ORDER) {
          try {
            localStorage.setItem(
              `pe.shelf.${shelf}`,
              next.closed.includes(SHELF_WORD[shelf]) ? "closed" : "open",
            );
          } catch {
            /* Collapse is still held in page state. */
          }
        }
    },
    onPick: (thread) => {
      setView((previous) => ({ ...previous, selected: [] }));
      onSelect(thread.id);
    },
  });
  useEffect(() => {
    if (JSON.stringify(list.state.search) !== JSON.stringify(threadSearchDefault()))
      setView((previous) => (previous.closed.length ? { ...previous, closed: [] } : previous));
  }, [list.state.search]);
  const currentListed = list.rows.some((row) => row.key === currentThreadId);
  const currentReveal = useRef({ thread: currentThreadId, complete: false });
  useEffect(() => {
    if (currentReveal.current.thread !== currentThreadId)
      currentReveal.current = { thread: currentThreadId, complete: false };
    // A shelf may need to open first. Reveal only a matching row so the core keeps authored filters.
    if (currentReveal.current.complete || !currentListed) return;
    currentReveal.current.complete = true;
    list.reveal(currentThreadId);
  }, [currentThreadId, currentListed, list.reveal]);
  const clearSelection = () => list.setState({ ...list.state, selected: [] });
  const selectedThreads = threads.filter((thread) => list.state.selected.includes(thread.id));
  const bulk = async (
    targets: RosterThread[],
    change: (thread: RosterThread) => UpdateThreadRequest,
    of: number,
  ) => {
    const outcomes = await Promise.all(
      targets.map((thread) => verbs.onUpdate(thread.id, change(thread))),
    );
    setBulkResult(`${outcomes.filter(Boolean).length} of ${of} threads changed`);
    clearSelection();
  };
  const rowParts = (thread: RosterThread): ListRowParts => {
    const shelf = shelfOf(thread, now);
    const reorder = shelf === "active" || shelf === "pinned";
    const work = works.of.get(thread.id);
    const lead = leadWork(work);
    // The remembered documents lead; the conversation title stands in when there are none.
    const title = documentsLabel(work) ?? thread.title;
    return {
      label: compactRows ? (
        <span className="pe-thread-label">
          <span className="pe-thread-title">{title}</span>
        </span>
      ) : (
        title
      ),
      // L1: a second line only when it holds Work; the harness mark rides the first.
      lines: compactRows || !lead ? 1 : 2,
      active: thread.id === currentThreadId,
      meta: (
        <span className="pe-thread-trail">
          <ThreadActivityMark thread={thread} now={now} woke={woken.has(thread.id)} />
          <CompactThreadTrail thread={thread} now={now} />
          {isUnread(thread) ? <span data-slot="nav-unread" role="img" aria-label="unread" /> : null}
        </span>
      ),
      sub:
        compactRows || !work || !lead ? undefined : (
          <span className="pe-thread-sub">
            <Button
              label={`Open ${lead.intent}`}
              onClick={(event) => {
                event.stopPropagation();
                void pressWork(thread.id, work, lead);
              }}
            >
              {lead.unfinished ? (
                <span className={chipRecipe().base()}>{lead.unfinished} unfinished</span>
              ) : null}
              <span className="min-w-0 truncate">
                {lead.intent}
                {work.works.length > 1 ? ` +${work.works.length - 1}` : ""}
              </span>
            </Button>
          </span>
        ),
      title: [rowHint(thread, work), unresumed.get(thread.id)].filter(Boolean).join(" · "),
      onDoubleClick: () => setMenuId(thread.id),
      onContextMenu: (event) => {
        event.preventDefault();
        setMenuId(thread.id);
      },
      draggable: true,
      onDragStart: (event) => event.dataTransfer.setData("text/pe-thread", thread.id),
      onDragOver: (event) => {
        if (reorder) event.preventDefault();
      },
      onDrop: reorder
        ? (event) => {
            event.preventDefault();
            event.stopPropagation();
            const id = event.dataTransfer.getData("text/pe-thread");
            if (!id || id === thread.id) return;
            const items = list.sections.find((section) => section.key === SHELF_WORD[shelf])!.rows;
            const before = items[items.findIndex((item) => item.key === thread.id) - 1]?.item;
            const order = before
              ? (threadOrder(before) + threadOrder(thread)) / 2
              : threadOrder(thread) - 1;
            void verbs.onUpdate(id, { status: "active", pinned: shelf === "pinned", order });
          }
        : undefined,
      actions: (
        <ThreadActions
          thread={thread}
          {...verbs}
          open={menuId === thread.id}
          setOpen={(open) => setMenuId(open ? thread.id : null)}
          selection={list.state.selected.includes(thread.id) ? selectedThreads : undefined}
          onMany={(targets, change, of) => void bulk(targets, change, of)}
        />
      ),
    };
  };
  return (
    <nav
      ref={navRef}
      data-thread-sidebar=""
      data-thread-rows={compactRows ? "compact" : undefined}
      aria-label="Threads"
      className="flex h-full min-h-0 flex-col"
    >
      {list.state.selected.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>{list.state.selected.length} selected</span>
          <span className="t-small text-ink-2">use any selected row's menu</span>
          <Button label="Clear" kind="framed" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      ) : null}
      {bulkResult ? (
        <p role="status" className="t-small">
          {bulkResult}
        </p>
      ) : null}
      <Scroll data-thread-roster="" className="min-h-0 flex-1">
        <ListView
          list={list}
          aria-label="threads"
          empty={
            reading
              ? { message: "reading threads…", exit: "" }
              : { message: "No threads yet", exit: "Start a new thread beside search" }
          }
          row={rowParts}
          sectionProps={(section) => {
            const shelf = SHELF_ORDER.find((key) => SHELF_WORD[key] === section.key)!;
            const acceptsDrop = shelf === "active" || shelf === "pinned" || shelf === "settled";
            return {
              "data-dim": shelf === "settled" || shelf === "archived",
              onDragOver: (event) => {
                if (acceptsDrop) event.preventDefault();
              },
              onDrop: (event) => {
                if (!acceptsDrop) return;
                event.preventDefault();
                const id = event.dataTransfer.getData("text/pe-thread");
                if (!id) return;
                void verbs.onUpdate(
                  id,
                  shelf === "pinned"
                    ? { pinned: true, order: Date.now() }
                    : {
                        status: shelf === "settled" ? "settled" : "active",
                        pinned: false,
                        order: Date.now(),
                      },
                );
              },
            };
          }}
        />
      </Scroll>
      {partial ? (
        <TooltipHint content={partial.hint}>
          <p className="m-0 px-(--gutter) t-small text-ink-mute" data-thread-work-partial="">
            {partial.line}
          </p>
        </TooltipHint>
      ) : null}
    </nav>
  );
}

/** Desktop and dialog share the pane's title modes and grouped actions. */
export function ThreadPane({
  mode,
  setMode,
  count,
  onNew,
  children,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  count: number | string;
  onNew: () => void;
  children: ReactNode;
}) {
  return (
    <Pane
      id="threads"
      title="threads"
      ground="artifact"
      scroll="clip"
      flush={mode === "threads"}
      tabs={
        <Switcher
          ariaLabel="View depth"
          value={mode}
          onChange={setMode}
          options={MODES.map((value) => ({
            value,
            title: MODE_HINT[value],
            label: (
              <>
                {value}
                {value === "threads" ? <small>{count}</small> : null}
              </>
            ),
          }))}
        />
      }
      actions={
        <Button label="New thread" onClick={onNew}>
          new
        </Button>
      }
    >
      {children}
    </Pane>
  );
}

export function NewThreadButton({ onNew }: { onNew: () => void }) {
  return (
    <Button
      type="button"
      kind="framed"
      icon={Plus}
      label="New thread"
      reason="Open an empty draft; first send creates the thread"
      onClick={onNew}
    >
      New thread
    </Button>
  );
}

const SHELF_WORD: Record<ThreadShelf, string> = {
  pinned: "Pinned",
  active: "Active",
  snoozed: "Snoozed",
  settled: "Settled",
  archived: "Archived",
};
const STATE_WORD: Record<ThreadActivity, string> = {
  working: "Working",
  waiting: "Waiting",
  failed: "Failed",
  idle: "Idle",
};
