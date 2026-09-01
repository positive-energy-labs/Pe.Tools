import { chatStyles } from "#/components/lang/chat-appearance";
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

/** Status dot shared by the sidebar list + palette. */
function ThreadDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={active ? chatStyles.threadDotActive() : chatStyles.threadDotQuiet()}
    />
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
            void onRename(thread.id, title);
        }}
      >
        <Pencil className={chatStyles.threadActionIcon()} />
      </Press>
      <Press
        type="button"
        aria-label="Delete thread"
        title="Delete thread"
        tone="quiet"
        state="rest"
        onClick={(event) => {
          event.stopPropagation();
          void onDelete(thread.id);
        }}
      >
        <X className={chatStyles.threadActionIcon()} />
      </Press>
    </>
  );
}

export function ThreadEmpty() {
  return (
    <main className={chatStyles.threadPalette0()}>
      <a href="/chat" className={chatStyles.threadPalette1()}>
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
    <div className={chatStyles.threadPalette2()}>
      <div className={chatStyles.threadPalette3()}>
        {shown.map((thread) => {
          const active = thread.id === currentThreadId;
          return (
            <div
              key={thread.id}
              // The open thread is a SELECTION — the selection fill, never a hue or a frame.
              className={active ? chatStyles.threadRowActive() : chatStyles.threadRowQuiet()}
              onClick={() => onSelect(thread.id)}
            >
              <ThreadDot active={active} />
              <span
                className={active ? chatStyles.threadTitleActive() : chatStyles.threadTitleQuiet()}
              >
                {thread.title}
              </span>
              <ThreadActions thread={thread} onRename={onRename} onDelete={onDelete} />
            </div>
          );
        })}
        {threads.length === 0 ? (
          <div className={chatStyles.threadPalette5()}>
            <EmptyState story="scope" exit="start one below — the first message names it">
              pick or start a thread
            </EmptyState>
          </div>
        ) : null}
      </div>

      <div className={chatStyles.threadPalette6()}>
        {/* page-scoped acts: neutral ink, veil on hover — no blue (blue = writes beyond / nav) */}
        <Press
          type="button"
          title="Start a new thread — the current one stays in the list"
          tone="neutral"
          onClick={onNew}
        >
          <Plus className={chatStyles.threadPalette7()} />
          New thread
        </Press>
        <Press
          type="button"
          title="Search every thread by title (⌘K)"
          tone="quiet"
          onClick={onSearch}
        >
          <Search className={chatStyles.threadPalette8()} />
          <span className={chatStyles.threadPalette9()}>Search all threads</span>
          {rest > 0 ? <span className={chatStyles.threadPalette10()}>+{rest}</span> : null}
          <kbd className={chatStyles.threadPalette11()}>⌘K</kbd>
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
          <Plus className={chatStyles.threadPalette12()} />
          <span className={chatStyles.threadPalette13()}>New thread</span>
          <kbd className={chatStyles.threadPalette14()}>⌘K</kbd>
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
                  className={
                    active ? chatStyles.paletteTitleActive() : chatStyles.paletteTitleQuiet()
                  }
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
