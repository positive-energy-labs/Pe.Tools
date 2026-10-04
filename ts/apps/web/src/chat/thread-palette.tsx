import { GitFork, Pencil, Plus, Search, X } from "lucide-react";
import type { HarnessId, HarnessInfo } from "@pe/agent-contracts";
import { Dialog, DialogContent } from "#/components/lang/dialog";
import { List } from "#/components/lang/list-popup";
import { EmptyState } from "#/components/lang/empty";
import type { StoredThreadSummary } from "#/workbench/provider";
import { Press } from "#/components/lang/press";
import { Kbd } from "#/components/lang/kbd";

/** Rename, one fork press per available harness (its own harness first), delete. */
function ThreadActions({
  thread,
  harnesses,
  onRename,
  onFork,
  onDelete,
}: {
  thread: StoredThreadSummary;
  harnesses: HarnessInfo[];
  onRename: (id: string, title: string) => void;
  onFork: (id: string, harness?: HarnessId) => void;
  onDelete: (id: string) => void;
}) {
  const forks = harnesses
    .filter((harness) => harness.available)
    .sort((a, b) => Number(b.id === thread.harness) - Number(a.id === thread.harness));
  return (
    <>
      {forks.map((harness) => {
        const own = harness.id === thread.harness;
        const title = own
          ? "Fork thread (same harness, context kept)"
          : `Fork to ${harness.title} (transcript re-fed)`;
        return (
          <Press
            key={harness.id}
            type="button"
            aria-label={title}
            title={title}
            tone="quiet"
            state="rest"
            onClick={(event) => {
              event.stopPropagation();
              onFork(thread.id, own ? undefined : harness.id);
            }}
          >
            <GitFork />
            {own ? null : <span className="t-small">{harness.title}</span>}
          </Press>
        );
      })}
      <Press
        type="button"
        aria-label="Rename thread"
        title="Rename thread"
        tone="quiet"
        state="rest"
        onClick={(event) => {
          event.stopPropagation();
          const title = window.prompt("Rename thread", thread.title)?.trim();
          if (title !== undefined && title !== "" && title !== thread.title)
            onRename(thread.id, title);
        }}
      >
        <Pencil />
      </Press>
      <Press
        type="button"
        aria-label="Delete thread"
        title="Delete thread"
        tone="quiet"
        state="rest"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(thread.id);
        }}
      >
        <X />
      </Press>
    </>
  );
}

/** The thread's harness and model, the quiet second line under its title. */
const threadSub = (thread: StoredThreadSummary) =>
  [thread.harness, thread.modelId].filter(Boolean).join(" · ");

/** Why a harness cannot start a thread, or undefined when it can. */
const refusal = (harness: HarnessInfo) =>
  harness.available ? undefined : (harness.reason ?? `${harness.title} is not installed`);

/**
 * Always-on sidebar thread list — the `threads` mode body, on the one list. Shows the 5 most
 * recent; everything else lives behind the ⌘K palette (onSearch). New/search live here.
 */
export function ThreadsSidebar({
  threads,
  harnesses,
  currentThreadId,
  onSelect,
  onNew,
  onFork,
  onRename,
  onDelete,
  onSearch,
  limit = 5,
}: {
  threads: StoredThreadSummary[];
  harnesses: HarnessInfo[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  onNew: (harness: HarnessId) => void;
  onFork: (id: string, harness?: HarnessId) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
  limit?: number;
}) {
  const shown = threads.slice(0, limit);
  const rest = threads.length - shown.length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-col py-1">
        <List<StoredThreadSummary>
          aria-label="threads"
          items={shown}
          keyOf={(thread) => thread.id}
          labelOf={(thread) => thread.title}
          empty={
            <EmptyState story="scope" exit="start one below — the first message names it">
              pick or start a thread
            </EmptyState>
          }
          onPick={(thread) => onSelect(thread.id)}
          row={(thread) => ({
            label: thread.title,
            sub: threadSub(thread),
            lines: 2,
            // The open thread is the active item: the rail mark, never a hue or a frame.
            active: thread.id === currentThreadId,
            actions: (
              <ThreadActions
                thread={thread}
                harnesses={harnesses}
                onRename={onRename}
                onFork={onFork}
                onDelete={onDelete}
              />
            ),
          })}
        />
      </div>

      <div className="hairline-t-faint mt-auto flex flex-col gap-1 p-2">
        <NewThreadButtons harnesses={harnesses} onNew={onNew} />
        <Press
          type="button"
          title="Search every thread by title (⌘K)"
          tone="quiet"
          onClick={onSearch}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search all threads</span>
          {rest > 0 ? <span className="face-mono text-ink-2">+{rest}</span> : null}
          <Kbd mute>⌘K</Kbd>
        </Press>
      </div>
    </div>
  );
}

/** One "New <harness> thread" press per harness; a missing one says why it cannot start. */
export function NewThreadButtons({
  harnesses,
  onNew,
}: {
  harnesses: HarnessInfo[];
  onNew: (harness: HarnessId) => void;
}) {
  // page-scoped acts: neutral ink, veil on hover — no blue (blue = writes beyond / nav)
  return harnesses.map((harness) => (
    <Press
      key={harness.id}
      type="button"
      title={
        refusal(harness) ??
        `Start a new ${harness.title} thread — the current one stays in the list`
      }
      tone="neutral"
      disabled={!harness.available}
      onClick={() => onNew(harness.id)}
    >
      <Plus className="size-3.5" />
      New {harness.title} thread
    </Press>
  ));
}

type PaletteItem =
  | { kind: "new"; harness: HarnessInfo }
  | { kind: "thread"; thread: StoredThreadSummary };

/** The thread palette (Ctrl/Cmd-K): the one List, fuzzy, in a Dialog. Full search across every thread. */
export function ThreadDialog({
  threads,
  harnesses,
  currentThreadId,
  open,
  onOpenChange,
  onSelect,
  onNew,
  onFork,
  onRename,
  onDelete,
}: {
  threads: StoredThreadSummary[];
  harnesses: HarnessInfo[];
  currentThreadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: (harness: HarnessId) => void;
  onFork: (id: string, harness?: HarnessId) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const items: PaletteItem[] = [
    ...harnesses.map((harness) => ({ kind: "new" as const, harness })),
    ...threads.map((thread) => ({ kind: "thread" as const, thread })),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent pad="none" showCloseButton={false} aria-label="Threads">
        <List<PaletteItem>
          aria-label="Threads"
          items={items}
          keyOf={(item) => (item.kind === "new" ? `__new__${item.harness.id}` : item.thread.id)}
          labelOf={(item) =>
            item.kind === "new" ? `New ${item.harness.title} thread` : item.thread.title
          }
          groupOf={(item) => (item.kind === "new" ? undefined : "Recent")}
          filter="fuzzy"
          searchPlaceholder="Search threads by title…"
          empty="no threads yet"
          noMatch="No threads match."
          maxHeight="18rem"
          onPick={(item) => {
            if (item.kind === "new") {
              if (!item.harness.available) return;
              onNew(item.harness.id);
            } else onSelect(item.thread.id);
            onOpenChange(false);
          }}
          onEscape={() => onOpenChange(false)}
          row={(item) =>
            item.kind === "new"
              ? {
                  lead: <Plus />,
                  label: `New ${item.harness.title} thread`,
                  refusal: refusal(item.harness) ?? null,
                }
              : {
                  label: item.thread.title,
                  sub: threadSub(item.thread),
                  lines: 2,
                  active: item.thread.id === currentThreadId,
                  actions: (
                    <ThreadActions
                      thread={item.thread}
                      harnesses={harnesses}
                      onRename={onRename}
                      onFork={onFork}
                      onDelete={onDelete}
                    />
                  ),
                }
          }
        />
      </DialogContent>
    </Dialog>
  );
}
