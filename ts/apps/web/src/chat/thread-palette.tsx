import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleCheck,
  Copy,
  GitFork,
  ListFilter,
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
  type LucideIcon,
} from "lucide-react";
import { type DocumentRequest, type Provider, type UpdateThreadRequest } from "@pe/agent-contracts";
import { Dialog, DialogContent, DialogTitle } from "#/components/lang/dialog";
import { ListPopup } from "#/components/lang/list-popup";
import { CommandPalette } from "#/components/lang/command-palette";
import { Input } from "#/components/lang/input";
import { EmptyState } from "#/components/lang/empty";
import {
  NavigationFilter,
  NavigationFilters,
  NavigationGroup,
  NavigationItem,
  NavigationMore,
  NavigationSearch,
  NavigationToggle,
} from "#/components/lang/navigation";
import { Kbd } from "#/components/lang/kbd";
import { Button } from "#/components/lang/button";
import { ProviderMark } from "#/components/lang/provider-mark";
import type { StoredThreadSummary } from "#/workbench/provider";
import { isReady } from "#/workbench/provider/providers";
import {
  isUnread,
  shelfOf,
  targetFacet,
  targetFacets,
  targetLabel,
  relativeThreadAge,
  threadOrder,
  activityWord,
  wokeFromSnooze,
  visibleThreads,
  THREAD_STATES,
  oneThreadRefusal,
  threadVerbs,
  type ThreadActivity,
  type ThreadShelf,
  type TargetRead,
  type ThreadVerb,
} from "./thread-navigation";

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

function ThreadActions({
  thread,
  open,
  setOpen,
  onFilterTarget,
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
  /** Present (the sidebar), the menu offers to narrow the roster to this thread's target. */
  onFilterTarget?: () => void;
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
    verb: ThreadVerb<RosterThread>,
    change: (thread: RosterThread) => UpdateThreadRequest = verb.change!,
  ) =>
    count > 1
      ? onMany?.(verb.targets, change, count)
      : void verbs.onUpdate(thread.id, change(thread));
  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).catch(() => setFailure(`Could not copy the ${what}`));
  const lifecycle = thread.lifecycle;
  const forks = verbs.providers.filter(isReady);
  const now = new Date();
  const plan = threadVerbs(group);
  const verbOf = (id: ThreadVerb["id"]) => plan.find((verb) => verb.id === id)!;
  const lifecycleAction = (id: ThreadVerb["id"], icon: LucideIcon, groupName?: string): Action => {
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
  const actions: Action[] = [
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
    ...(thread.head.defaultTarget
      ? [
          {
            id: "new-target",
            label: "New thread on this target",
            sub: count > 1 ? undefined : targetLabel(thread),
            icon: SquarePen,
            group: " ",
            refusal: oneThreadRefusal("New thread", count) ?? verbOf("new-target").refusal,
            run: () => verbs.onNewTarget(thread.head.defaultTarget),
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
              oneThreadRefusal("Fork", count) ?? (busy ? "wait for the turn to finish" : undefined),
            children: forks.map((provider) => ({
              id: `fork:${provider.id}`,
              label: provider.name,
              run: () => verbs.onFork(thread.id, provider.id),
            })),
          },
        ]
      : []),
    ...(onFilterTarget
      ? [
          {
            id: "filter",
            label: "Filter by target",
            sub: count > 1 ? undefined : targetLabel(thread),
            icon: ListFilter,
            group: "  ",
            refusal: oneThreadRefusal("Filter", count),
            run: onFilterTarget,
          },
        ]
      : []),
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
            url.searchParams.set("thread", thread.id);
            copy(url.href, "thread link");
          },
        },
        {
          id: "copy:id",
          label: "Thread id",
          sub: thread.id,
          reading: true,
          run: () => copy(thread.id, "thread id"),
        },
        ...(thread.head.defaultTarget
          ? [
              {
                id: "copy:target",
                label: "Exact target",
                sub: targetLabel(thread),
                run: () => copy(JSON.stringify(thread.head.defaultTarget), "target"),
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
            items: () => actions,
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
          {count > 1 ? null : <p className="t-small text-ink-2">{targetLabel(thread)}</p>}
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
                  apply(snooze, () => ({ snoozedUntil: time.toISOString() }));
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

const SETTLED_PAGE = 10;
const SETTLED_MORE = 25;

export function ThreadsSidebar({
  threads,
  currentThreadId,
  onSelect,
  onNew,
  onSearch,
  ...verbs
}: ThreadVerbs & {
  threads: RosterThread[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
}) {
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now);
  const previousThreads = useRef(new Map<string, RosterThread>());
  const [woken, setWoken] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    // shortcut: wake marks survive only this sidebar mount, persist a wake reason if reloads must retain them.
    const priorThreads = previousThreads.current;
    setWoken((previous) => {
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
      return next.size === previous.size && [...next].every((id) => previous.has(id))
        ? previous
        : next;
    });
    previousThreads.current = new Map(threads.map((thread) => [thread.id, thread]));
  }, [threads, currentThreadId, now]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [settledLimit, setSettledLimit] = useState(SETTLED_PAGE);
  const [target, setTarget] = useState("*");
  const [provider, setProvider] = useState("*");
  const [state, setState] = useState<ThreadActivity | "*">("*");
  const [unread, setUnread] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkResult, setBulkResult] = useState("");
  // Archive lives outside the roster (the palette and the menu reach it); the open thread still
  // shows on its shelf so the place you stand is never missing from the list.
  const archivedHere = threads.find(
    (thread) => thread.id === currentThreadId && thread.lifecycle.status === "archived",
  );
  const roster = { query, filter: "all", target, provider, state } as const;
  const shown = [
    ...visibleThreads(threads, { ...roster, unread }),
    ...(archivedHere ? [archivedHere] : []),
  ];
  const unreadCount = visibleThreads(threads, { ...roster, unread: true }).length;
  const facets = useMemo(
    () => ({
      targets: targetFacets(threads),
      providers: [
        ...new Map(threads.map((thread) => [thread.providerId, thread.providerName])).entries(),
      ].map(([key, label]) => ({ key, label })),
    }),
    [threads],
  );
  const select = (id: string, range: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      const anchor = [...previous].at(-1);
      if (range && anchor) {
        const a = shown.findIndex((item) => item.id === anchor),
          b = shown.findIndex((item) => item.id === id);
        for (const item of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(item.id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const selectedThreads = threads.filter((thread) => selected.has(thread.id));
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
  const shelves = SHELF_ORDER.map((shelf) => ({
    shelf,
    all: shown.filter((thread) => shelfOf(thread) === shelf),
  })).filter(({ all }) => all.length);
  return (
    <nav
      data-navigation=""
      aria-label="Threads"
      className="flex h-full min-h-0 flex-col gap-(--gutter)"
      // Escape clears the selection unless a menu or dialog above it is taking the key.
      onKeyDown={(event) => {
        if (event.key === "Escape" && selected.size && !menuId && !event.defaultPrevented) {
          event.stopPropagation();
          clearSelection();
        }
      }}
    >
      <NavigationSearch
        value={query}
        onChange={setQuery}
        actions={
          <>
            <Button label="Search every thread" reason="Search every thread" onClick={onSearch}>
              <Kbd mute hotkey="Mod+K" />
            </Button>
            <Button icon={Plus} label="New thread" onClick={onNew} />
          </>
        }
      />
      <NavigationFilters>
        <NavigationFilter
          label="Target"
          all="All targets"
          options={facets.targets}
          value={target}
          onChange={setTarget}
        />
        <NavigationFilter
          label="Provider"
          all="All providers"
          options={facets.providers}
          value={provider}
          onChange={setProvider}
        />
        <NavigationFilter
          label="State"
          all="All states"
          options={THREAD_STATES.map((key) => ({ key, label: STATE_WORD[key] }))}
          value={state}
          onChange={setState}
        />
        <NavigationToggle
          label="Unread"
          count={unreadCount}
          pressed={unread}
          onChange={setUnread}
        />
      </NavigationFilters>
      {selected.size ? (
        <div className="flex flex-wrap items-center gap-1">
          <span>{selected.size} selected</span>
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
      <div
        data-navigation-roster=""
        className="min-h-0 flex-1 overflow-y-auto"
        // A click on the list's own empty space (not a row, not a head) clears the selection.
        onClick={(event) => {
          if (event.target === event.currentTarget) clearSelection();
        }}
      >
        {!shown.length ? (
          <div className="px-(--gutter) py-3">
            <EmptyState
              story={threads.length ? "filter" : "scope"}
              exit={
                threads.length
                  ? "clear the search and the filters"
                  : "start a new thread beside search"
              }
            >
              {threads.length ? "No threads match" : "No threads yet"}
            </EmptyState>
          </div>
        ) : null}
        {shelves.map(({ shelf, all }, index) => {
          const compact = shelf === "settled" || shelf === "snoozed" || shelf === "archived";
          // The settled tail pages (T3: 10, then 25 at a time) and always keeps the open thread.
          const paged = shelf === "settled" && !query;
          const items = paged
            ? all.filter((thread, index) => index < settledLimit || thread.id === currentThreadId)
            : all;
          return (
            <NavigationGroup
              key={shelf}
              label={shelf}
              count={all.length}
              compact={compact}
              dim={shelf === "settled" || shelf === "archived"}
              persist={shelf}
              stack={{ index, of: shelves.length }}
              forceOpen={!!query || items.some((item) => item.id === currentThreadId)}
              onDrop={
                shelf === "active" || shelf === "pinned" || shelf === "settled"
                  ? (id) =>
                      void verbs.onUpdate(
                        id,
                        shelf === "pinned"
                          ? { pinned: true, order: Date.now() }
                          : {
                              status: shelf === "settled" ? "settled" : "active",
                              pinned: false,
                              order: Date.now(),
                            },
                      )
                  : undefined
              }
            >
              {items.map((thread, index) => (
                <NavigationItem
                  key={thread.id}
                  id={thread.id}
                  title={thread.title}
                  target={
                    thread.head.defaultTarget ? (
                      <span title={exactTarget(thread.head.defaultTarget)}>
                        {targetLabel(thread)}
                      </span>
                    ) : undefined
                  }
                  time={
                    <time
                      dateTime={thread.updatedAt}
                      title={new Date(thread.updatedAt).toLocaleString()}
                    >
                      {relativeThreadAge(thread.updatedAt, now)}
                    </time>
                  }
                  mark={<ProviderMark harness={thread.harness} />}
                  meta={[thread.providerName, thread.modelId].filter(Boolean).join(" · ")}
                  state={
                    shelf === "snoozed"
                      ? wakeLabel(new Date(thread.lifecycle.snoozedUntil!), new Date(now))
                      : (activityWord(thread) ?? (woken.has(thread.id) ? "Woke" : undefined))
                  }
                  stateTone={
                    thread.activity.state === "failed"
                      ? "alarm"
                      : thread.activity.pending
                        ? "caution"
                        : woken.has(thread.id)
                          ? "caution"
                          : undefined
                  }
                  activity={
                    shelf === "snoozed"
                      ? "snoozed"
                      : thread.activity.pending || thread.activity.state === "waiting"
                        ? "waiting"
                        : thread.activity.state === "running"
                          ? "running"
                          : thread.activity.state === "failed"
                            ? "failed"
                            : woken.has(thread.id)
                              ? "woke"
                              : undefined
                  }
                  unread={isUnread(thread)}
                  active={thread.id === currentThreadId}
                  compact={compact}
                  selected={selected.has(thread.id)}
                  onSelect={(range) => select(thread.id, range)}
                  onPick={() => {
                    clearSelection();
                    onSelect(thread.id);
                  }}
                  onRename={() => setMenuId(thread.id)}
                  onMenu={() => setMenuId(thread.id)}
                  onDrop={
                    !compact
                      ? (id) => {
                          if (!id || id === thread.id) return;
                          const before = items[index - 1];
                          const order = before
                            ? (threadOrder(before) + threadOrder(thread)) / 2
                            : threadOrder(thread) - 1;
                          void verbs.onUpdate(id, {
                            status: "active",
                            pinned: shelf === "pinned",
                            order,
                          });
                        }
                      : undefined
                  }
                  actions={
                    <ThreadActions
                      thread={thread}
                      {...verbs}
                      open={menuId === thread.id}
                      setOpen={(open) => setMenuId(open ? thread.id : null)}
                      selection={selected.has(thread.id) ? selectedThreads : undefined}
                      onMany={(targets, change, of) => void bulk(targets, change, of)}
                      onFilterTarget={() => setTarget(targetFacet(thread))}
                    />
                  }
                />
              ))}
              {paged && all.length > items.length ? (
                <NavigationMore
                  onMore={() => setSettledLimit((limit) => limit + SETTLED_MORE)}
                  hidden={all.length - items.length}
                  step={SETTLED_MORE}
                />
              ) : null}
            </NavigationGroup>
          );
        })}
      </div>
    </nav>
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

const SHELF_ORDER: ThreadShelf[] = ["pinned", "active", "snoozed", "settled", "archived"];
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
const UNFILTERED = { target: "*", provider: "*", state: "*", unread: false } as const;

/** Every thread, archive included, on the sidebar's own row anatomy, grouped by shelf. */
export function ThreadDialog({
  threads,
  currentThreadId,
  open,
  onOpenChange,
  onSelect,
  onNew,
}: ThreadVerbs & {
  threads: RosterThread[];
  currentThreadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const now = Date.now();
  const roster = [
    ...visibleThreads(threads, { query: "", filter: "all", ...UNFILTERED, now }),
    ...visibleThreads(threads, { query: "", filter: "archived", ...UNFILTERED, now }),
  ].sort((a, b) => SHELF_ORDER.indexOf(shelfOf(a, now)) - SHELF_ORDER.indexOf(shelfOf(b, now)));
  return (
    <CommandPalette<RosterThread>
      open={open}
      onOpenChange={onOpenChange}
      aria-label="Threads"
      items={roster}
      keyOf={(thread) => thread.id}
      labelOf={(thread) =>
        `${thread.title} ${targetLabel(thread)} ${thread.providerName} ${thread.modelId ?? ""}`
      }
      groupOf={(thread) => SHELF_WORD[shelfOf(thread, now)]}
      filter="fuzzy"
      searchAbove={0}
      searchPlaceholder="Search every thread"
      empty="No threads yet"
      noMatch="No threads match"
      maxHeight="min(32rem, 60dvh)"
      onPick={(thread) => {
        onSelect(thread.id);
      }}
      row={(thread) => {
        const activity = activityWord(thread);
        return {
          lead: <ProviderMark harness={thread.harness} />,
          label: thread.title,
          sub: [
            [thread.providerName, thread.modelId].filter(Boolean).join(" · "),
            thread.head.defaultTarget ? targetLabel(thread) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          lines: 2,
          active: thread.id === currentThreadId,
          meta: (
            <span className="flex items-center gap-1.5">
              {activity ? (
                <span
                  data-slot="nav-state"
                  data-tone={
                    thread.activity.state === "failed"
                      ? "alarm"
                      : thread.activity.pending
                        ? "caution"
                        : undefined
                  }
                >
                  {activity}
                </span>
              ) : (
                relativeThreadAge(thread.updatedAt, now)
              )}
              {isUnread(thread) ? (
                <span data-slot="nav-unread" role="img" aria-label="unread" />
              ) : null}
            </span>
          ),
        };
      }}
      footer={
        <div className="flex items-center justify-between gap-3 px-1 pb-1">
          <NewThreadButton
            onNew={() => {
              onNew();
              onOpenChange(false);
            }}
          />
          <span className="flex items-center gap-1.5 t-small text-ink-2">
            <Kbd>↑↓</Kbd> move <Kbd hotkey="Enter" /> open <Kbd hotkey="Escape" /> close
          </span>
        </div>
      }
    />
  );
}

/** The exact target a row's short label stands for: its path, or the session and open id. */
function exactTarget(target: DocumentRequest): string {
  return target.kind === "named" ? target.address : `${target.ref.session} · ${target.ref.openId}`;
}
