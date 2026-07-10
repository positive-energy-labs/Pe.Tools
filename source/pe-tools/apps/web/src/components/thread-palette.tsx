import { Plus, Search, X } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import type { StoredThreadSummary } from "#/workbench/provider";

/** Last path segment of a cwd, for a compact right-aligned hint. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Status dot shared by the sidebar list + palette. */
function ThreadDot({ thread, active }: { thread: StoredThreadSummary; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${
        thread.promptActive ? "animate-pulse bg-primary" : active ? "bg-accent-foreground" : "bg-border"
      }`}
    />
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
              className={`group/row flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                active ? "bg-[var(--paper)] shadow-[inset_0_0_0_0.5px_var(--line)]" : "hover:bg-[var(--paper-2)]"
              }`}
              onClick={() => onSelect(thread.id)}
            >
              <ThreadDot thread={thread} active={active} />
              <span className={`min-w-0 flex-1 truncate ${active ? "font-medium text-foreground" : "text-[var(--slate)]"}`}>
                {thread.title}
              </span>
              {thread.promptActive ? (
                <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                  running
                </span>
              ) : thread.cwd ? (
                <span className="hidden shrink-0 truncate font-mono text-[10px] text-muted-foreground group-hover/row:hidden sm:inline">
                  {basename(thread.cwd)}
                </span>
              ) : null}
              <button
                type="button"
                title="Delete thread"
                className="hidden shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:inline hover:bg-background hover:text-destructive"
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
        {threads.length === 0 ? (
          <div className="px-2 py-3 text-[13px] text-muted-foreground">No threads yet.</div>
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-1 border-t-[0.5px] border-[var(--line)] p-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--pe-blue)] hover:bg-[var(--paper-2)]"
          onClick={onNew}
        >
          <Plus className="size-4" />
          New thread
        </button>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--slate)] hover:bg-[var(--paper-2)]"
          onClick={onSearch}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search all threads</span>
          {rest > 0 ? <span className="text-[11px] text-muted-foreground">+{rest}</span> : null}
          <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
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
          className="mb-1 gap-2.5 rounded-lg px-3 py-2.5 text-primary data-selected:bg-primary/10 data-selected:text-primary"
        >
          <Plus className="size-4" />
          <span className="flex-1 font-medium">New thread</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
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
                className="group/row gap-2.5 rounded-lg px-3 py-2.5 data-selected:bg-[var(--paper-2)]"
              >
                <ThreadDot thread={thread} active={active} />
                <span
                  className={`flex-1 truncate ${active ? "font-medium text-foreground" : "text-foreground/85"}`}
                >
                  {thread.title}
                </span>
                {thread.promptActive ? (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                    running
                  </span>
                ) : null}
                {thread.cwd ? (
                  <span className="hidden max-w-[35%] shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:inline">
                    {basename(thread.cwd)}
                  </span>
                ) : null}
                <button
                  type="button"
                  title="Delete thread"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-background hover:text-destructive data-selected:opacity-100"
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
