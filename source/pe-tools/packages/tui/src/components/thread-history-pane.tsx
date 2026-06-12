import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type { WorkbenchState, WorkbenchThreadInfo } from "@pe/workbench-core";
import { peaTheme } from "../theme.js";

export function ThreadHistoryPane(props: {
  state: Accessor<WorkbenchState>;
  selectedThreadId?: string;
  loading?: boolean;
  error?: string;
  onRefresh: () => void;
  onSelect: (threadId: string) => void;
}): JSX.Element {
  const threads = createMemo(() => sortThreads(props.state().threads));
  const activeThreadId = createMemo(
    () => props.state().activeThreadId ?? props.state().session?.sessionId,
  );

  return (
    <box
      width={28}
      height="100%"
      flexDirection="column"
      backgroundColor={peaTheme.backgroundPanel}
      border={["right"]}
      borderColor={peaTheme.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={peaTheme.primary}>threads</text>
        <text fg={peaTheme.textMuted} onMouseDown={props.onRefresh}>
          refresh
        </text>
      </box>
      <text fg={peaTheme.textMuted}>{props.loading ? "loading…" : "enter loads selected"}</text>
      {props.error ? <text fg={peaTheme.error}>{props.error}</text> : null}
      <scrollbox flexGrow={1} scrollY paddingTop={1}>
        {threads().length === 0 ? <text fg={peaTheme.textMuted}>No history yet.</text> : null}
        {threads().map((thread) => (
          <ThreadRow
            thread={thread}
            active={thread.threadId === activeThreadId()}
            selected={thread.threadId === props.selectedThreadId}
            onSelect={() => props.onSelect(thread.threadId)}
          />
        ))}
      </scrollbox>
      <box border={["top"]} borderColor={peaTheme.border} paddingTop={1}>
        <text fg={peaTheme.textMuted}>ctrl+r refresh · ↑/↓ select</text>
      </box>
    </box>
  );
}

function ThreadRow(props: {
  thread: WorkbenchThreadInfo;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const marker = props.active ? "●" : props.selected ? "›" : " ";
  return (
    <box
      flexDirection="column"
      paddingBottom={1}
      backgroundColor={props.selected ? peaTheme.backgroundElement : peaTheme.backgroundPanel}
      onMouseDown={props.onSelect}
    >
      <text
        fg={props.active ? peaTheme.primary : props.selected ? peaTheme.text : peaTheme.textMuted}
      >
        {`${marker} ${threadTitle(props.thread)}`}
      </text>
      <text fg={peaTheme.textMuted}>{threadSubtitle(props.thread)}</text>
    </box>
  );
}

function sortThreads(threads: WorkbenchThreadInfo[]): WorkbenchThreadInfo[] {
  return [...threads].sort((left, right) => timestamp(right) - timestamp(left));
}

function timestamp(thread: WorkbenchThreadInfo): number {
  return thread.updatedAt ? Date.parse(thread.updatedAt) || 0 : 0;
}

function threadTitle(thread: WorkbenchThreadInfo): string {
  return thread.title?.trim() || shortId(thread.threadId);
}

function threadSubtitle(thread: WorkbenchThreadInfo): string {
  const date = thread.updatedAt ? new Date(thread.updatedAt).toLocaleString() : undefined;
  return [date, shortId(thread.threadId)].filter(Boolean).join(" · ");
}

function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}
