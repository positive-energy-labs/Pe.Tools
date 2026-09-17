import { Pencil, Plus, Search, X } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/lang/command";
import { EmptyState } from "#/components/lang/empty";
import type { StoredThreadSummary } from "#/workbench/provider";
import { Press } from "#/components/lang/press";
import { Kbd } from "#/components/lang/kbd";
import { threadRowRecipe } from "./appearance";

/** Status dot shared by the sidebar list + palette. */
function ThreadDot({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
      <span
        className={active ? "size-1.5 rounded-full bg-ink" : "size-1.5 rounded-full bg-line-2"}
      />
    </span>
  );
}

function ThreadActions({
  thread,
  onRename,
  onDelete,
}: {
  thread: StoredThreadSummary;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
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
        <Pencil className="size-3.5" />
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
        <X className="size-3.5" />
      </Press>
    </>
  );
}

export function ThreadEmpty() {
  return (
    <main className="grid min-h-screen place-items-center font-sans" data-surface="page">
      <a href="/chat" className="veil rounded-sm px-3 py-2">
        <EmptyState story="scope" exit="open the thread palette">
          pick or start a thread
        </EmptyState>
      </a>
    </main>
  );
}

/**
 * Always-on sidebar thread list — the `threads` mode body. Shows the 5 most recent by default;
 * everything else lives behind the ⌘K palette (onSearch). New/search live here now, not the header.
 */
export function ThreadList({
  threads,
  currentThreadId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onSearch,
  limit = 5,
}: {
  threads: StoredThreadSummary[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
  limit?: number;
}) {
  const shown = threads.slice(0, limit);
  const rest = threads.length - shown.length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 p-2">
        {shown.map((thread) => {
          const active = thread.id === currentThreadId;
          const row = threadRowRecipe({ active });
          return (
            <div
              key={thread.id}
              // The open thread is a SELECTION — the selection fill, never a hue or a frame.
              data-selected={active ? "" : undefined}
              className={row.root()}
              onClick={() => onSelect(thread.id)}
            >
              <ThreadDot active={active} />
              <span className={row.title()}>{thread.title}</span>
              <ThreadActions thread={thread} onRename={onRename} onDelete={onDelete} />
            </div>
          );
        })}
        {threads.length === 0 ? (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="start one below — the first message names it">
              pick or start a thread
            </EmptyState>
          </div>
        ) : null}
      </div>

      <div className="hairline-t-faint mt-auto flex flex-col gap-1 p-2">
        {/* page-scoped acts: neutral ink, veil on hover — no blue (blue = writes beyond / nav) */}
        <Press
          type="button"
          title="Start a new thread — the current one stays in the list"
          tone="neutral"
          onClick={onNew}
        >
          <Plus className="size-3.5" />
          New thread
        </Press>
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

/** Thread picker — shadcn Command palette (Ctrl/Cmd-K). Full search across every thread. */
export function ThreadPalette({
  threads,
  currentThreadId,
  open,
  onOpenChange,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  threads: StoredThreadSummary[];
  currentThreadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Threads"
      description="Search threads"
    >
      <CommandInput placeholder="Search threads by title…" />
      <CommandList>
        <CommandEmpty>No threads match.</CommandEmpty>
        <CommandItem
          value="__new__ new thread"
          onSelect={() => {
            onNew();
            onOpenChange(false);
          }}
          // keyboard cursor = selection fill, never a hue
        >
          <Plus className="size-3.5" />
          <span className="flex-1">New thread</span>
          <Kbd mute>⌘K</Kbd>
        </CommandItem>
        <CommandGroup heading="Recent">
          {threads.map((thread) => {
            const active = thread.id === currentThreadId;
            return (
              <CommandItem
                key={thread.id}
                value={`${thread.title} ${thread.id}`}
                onSelect={() => {
                  onSelect(thread.id);
                  onOpenChange(false);
                }}
              >
                <ThreadDot active={active} />
                <span
                  className={active ? "flex-1 truncate text-ink" : "flex-1 truncate text-ink-2"}
                >
                  {thread.title}
                </span>
                <ThreadActions thread={thread} onRename={onRename} onDelete={onDelete} />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
