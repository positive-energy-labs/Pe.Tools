import { Plus, Search, X } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { EmptyState } from "#/components/lang/empty";
import type { StoredThreadSummary } from "#/workbench/provider";

/** Last path segment of a cwd, for a compact right-aligned hint. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Status dot shared by the sidebar list + palette. A running prompt is BUSY (neutral ink,
 * pulsing) — never blue; the open thread's dot is full ink; idle threads are hairline-grey. */
function ThreadDot({ thread, active }: { thread: StoredThreadSummary; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${
        thread.promptActive
          ? "animate-pulse bg-[var(--r-ink-2)]"
          : active
            ? "bg-[var(--r-ink)]"
            : "bg-[var(--r-line-2)]"
      }`}
    />
  );
}

export function ThreadEmpty() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--r-page)] font-pe">
      <a href="/chat" className="rounded-sm px-3 py-2 hover:bg-[var(--r-veil)]">
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
  onDelete,
  onSearch,
  limit = 5,
}: {
  threads: StoredThreadSummary[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
  limit?: number;
}) {
  const shown = threads.slice(0, limit);
  const rest = threads.length - shown.length;
  const groups = shown.reduce<Array<[string, StoredThreadSummary[]]>>((all, thread) => {
    const document = thread.documentAddress ?? "No document";
    const group = all.find(([key]) => key === document);
    if (group) group[1].push(thread);
    else all.push([document, [thread]]);
    return all;
  }, []);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 p-2">
        {groups.map(([document, documentThreads]) => (
          <div key={document}>
            <div className="px-2 pb-1 pt-2 t-caption face-mono text-[var(--r-ink-2)]">
              {document === "No document" ? document : basename(document)}
            </div>
            {documentThreads.map((thread) => {
              const active = thread.id === currentThreadId;
              return (
            <div
              key={thread.id}
              // The open thread is a SELECTION — the selection fill, never a hue or a frame.
              className={`group/row flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 t-prose ${
                active
                  ? "bg-[var(--r-select)] [--r-on:var(--r-select)]"
                  : "hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
              }`}
              onClick={() => onSelect(thread.id)}
            >
              <ThreadDot thread={thread} active={active} />
              <span
                className={`min-w-0 flex-1 truncate ${active ? "text-[var(--r-ink)]" : "text-[var(--r-ink-2)]"}`}
              >
                {thread.title}
              </span>
              {thread.promptActive ? (
                <span
                  className="t-caption face-mono shrink-0 text-[var(--r-ink-2)]"
                  title="A prompt is in flight on this thread"
                >
                  running
                </span>
              ) : thread.cwd ? (
                <span className="t-value face-mono hidden shrink-0 truncate text-[var(--r-ink-2)] group-hover/row:hidden sm:inline">
                  {basename(thread.cwd)}
                </span>
              ) : null}
              <button
                type="button"
                title="Delete thread"
                className="hidden shrink-0 rounded-sm p-0.5 text-[var(--r-ink-2)] group-hover/row:inline hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(thread.id);
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
              );
            })}
          </div>
        ))}
        {threads.length === 0 ? (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="start one below — the first message names it">
              pick or start a thread
            </EmptyState>
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-1 border-t-[0.5px] border-[var(--r-line)] p-2">
        {/* page-scoped acts: neutral ink, veil on hover — no blue (blue = writes beyond / nav) */}
        <button
          type="button"
          title="Start a new thread — the current one stays in the list"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 t-prose text-[var(--r-ink)] hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
          onClick={onNew}
        >
          <Plus className="size-4" />
          New thread
        </button>
        <button
          type="button"
          title="Search every thread by title or folder (⌘K)"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 t-prose text-[var(--r-ink-2)] hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
          onClick={onSearch}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search all threads</span>
          {rest > 0 ? (
            <span className="t-value face-mono text-[var(--r-ink-2)]">+{rest}</span>
          ) : null}
          <kbd className="rounded-sm border border-[var(--r-line-2)] px-1 py-0.5 t-caption face-mono text-[var(--r-ink-2)]">
            ⌘K
          </kbd>
        </button>
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
  onDelete,
}: {
  threads: StoredThreadSummary[];
  currentThreadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Threads"
      description="Search threads"
      className="overflow-hidden rounded-xl sm:max-w-xl"
    >
      <CommandInput placeholder="Search threads by title or folder…" className="h-12 text-[15px]" />
      <CommandList className="max-h-[60vh] p-1.5">
        <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
          No threads match.
        </CommandEmpty>
        <CommandItem
          value="__new__ new thread"
          onSelect={() => {
            onNew();
            onOpenChange(false);
          }}
          // keyboard cursor = selection fill, never a hue
          className="mb-1 gap-2.5 rounded-sm px-3 py-2.5 text-[var(--r-ink)] data-selected:bg-[var(--r-select)]"
        >
          <Plus className="size-4" />
          <span className="flex-1">New thread</span>
          <kbd className="rounded-sm border border-[var(--r-line-2)] px-1.5 py-0.5 t-caption face-mono text-[var(--r-ink-2)]">
            ⌘K
          </kbd>
        </CommandItem>
        <CommandGroup
          heading="Recent"
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:uppercase"
        >
          {threads.map((thread) => {
            const active = thread.id === currentThreadId;
            return (
              <CommandItem
                key={thread.id}
                // cmdk filters on value text — include title + cwd so search matches both.
                value={`${thread.title} ${thread.cwd ?? ""} ${thread.id}`}
                onSelect={() => {
                  onSelect(thread.id);
                  onOpenChange(false);
                }}
                className="group/row gap-2.5 rounded-sm px-3 py-2.5 data-selected:bg-[var(--r-select)]"
              >
                <ThreadDot thread={thread} active={active} />
                <span
                  className={`flex-1 truncate ${active ? "text-[var(--r-ink)]" : "text-[var(--r-ink)]/85"}`}
                >
                  {thread.title}
                </span>
                {thread.promptActive ? (
                  <span
                    className="t-caption face-mono shrink-0 text-[var(--r-ink-2)]"
                    title="A prompt is in flight on this thread"
                  >
                    running
                  </span>
                ) : null}
                {thread.cwd ? (
                  <span className="t-value face-mono hidden max-w-[35%] shrink-0 truncate text-[var(--r-ink-2)] sm:inline">
                    {basename(thread.cwd)}
                  </span>
                ) : null}
                <button
                  type="button"
                  title="Delete thread"
                  className="shrink-0 rounded-sm p-0.5 text-[var(--r-ink-2)] opacity-0 transition-opacity group-hover/row:opacity-100 hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))] data-selected:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(thread.id);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
