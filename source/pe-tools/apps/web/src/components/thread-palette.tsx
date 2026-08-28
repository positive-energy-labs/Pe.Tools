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
import { Press } from "#/components/lang/press";

/** Status dot shared by the sidebar list + palette. */
function ThreadDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${active ? "bg-ink" : "bg-line-2"}`}
    />
  );
}

export function ThreadEmpty() {
  return (
    <main className="grid min-h-screen place-items-center bg-page font-sans">
      <a href="/chat" className="rounded-sm px-3 py-2 hover:veil">
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 p-2">
        {shown.map((thread) => {
          const active = thread.id === currentThreadId;
          return (
            <div
              key={thread.id}
              // The open thread is a SELECTION — the selection fill, never a hue or a frame.
              className={`group/row flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 t-prose ${
                active ? "on-select" : "hover:veil"
              }`}
              onClick={() => onSelect(thread.id)}
            >
              <ThreadDot active={active} />
              <span className={`min-w-0 flex-1 truncate ${active ? "text-ink" : "text-ink-2"}`}>
                {thread.title}
              </span>
              <Press
                type="button"
                title="Delete thread"
                className="hidden shrink-0 rounded-sm p-0.5 text-ink-2 group-hover/row:inline hover:veil"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(thread.id);
                }}
              >
                <X className="size-3.5" />
              </Press>
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

      <div className="mt-auto flex flex-col gap-1 border-t-[0.5px] border-line p-2">
        {/* page-scoped acts: neutral ink, veil on hover — no blue (blue = writes beyond / nav) */}
        <Press
          type="button"
          title="Start a new thread — the current one stays in the list"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 t-prose text-ink hover:veil"
          onClick={onNew}
        >
          <Plus className="size-4" />
          New thread
        </Press>
        <Press
          type="button"
          title="Search every thread by title (⌘K)"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 t-prose text-ink-2 hover:veil"
          onClick={onSearch}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search all threads</span>
          {rest > 0 ? <span className="t-value face-mono text-ink-2">+{rest}</span> : null}
          <kbd className="rounded-sm border border-line-2 px-1 py-0.5 t-caption face-mono text-ink-2">
            ⌘K
          </kbd>
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
      <CommandInput placeholder="Search threads by title…" className="h-12 t-prose" />
      <CommandList className="max-h-[60vh] p-1.5">
        <CommandEmpty className="py-10 text-center t-prose text-ink-2">
          No threads match.
        </CommandEmpty>
        <CommandItem
          value="__new__ new thread"
          onSelect={() => {
            onNew();
            onOpenChange(false);
          }}
          // keyboard cursor = selection fill, never a hue
          className="mb-1 gap-2.5 rounded-sm px-3 py-2.5 text-ink data-selected:bg-select"
        >
          <Plus className="size-4" />
          <span className="flex-1">New thread</span>
          <kbd className="rounded-sm border border-line-2 px-1.5 py-0.5 t-caption face-mono text-ink-2">
            ⌘K
          </kbd>
        </CommandItem>
        <CommandGroup
          heading="Recent"
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:t-caption [&_[cmdk-group-heading]]:t-upper"
        >
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
                className="group/row gap-2.5 rounded-sm px-3 py-2.5 data-selected:bg-select"
              >
                <ThreadDot active={active} />
                <span className={`flex-1 truncate ${active ? "text-ink" : "text-ink/85"}`}>
                  {thread.title}
                </span>
                <Press
                  type="button"
                  title="Delete thread"
                  className="shrink-0 rounded-sm p-0.5 text-ink-2 opacity-0 transition-opacity group-hover/row:opacity-100 hover:veil data-selected:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(thread.id);
                  }}
                >
                  <X className="size-3.5" />
                </Press>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
