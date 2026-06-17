import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type { WorkbenchDebugEvent, WorkbenchState, WorkbenchToolCall } from "@pe/workbench-core";
import { peaTheme } from "../theme.js";

export function ToolPane(props: { state: Accessor<WorkbenchState> }): JSX.Element {
  const toolCalls = createMemo(() => props.state().tools.calls.slice(-18).toReversed());
  const debugEvents = createMemo(() => props.state().debug.events.slice(-10).toReversed());
  const memories = createMemo(() => props.state().memory.entries.slice(-6).toReversed());
  const activeToolCallId = createMemo(() => props.state().uiStatus.overall.activeToolCallId);

  return (
    <box
      width={38}
      height="100%"
      flexDirection="column"
      backgroundColor={peaTheme.backgroundPanel}
      border={["left"]}
      borderColor={peaTheme.borderSubtle}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={peaTheme.primary}>inspector</text>
      <scrollbox flexGrow={1} scrollY paddingTop={1}>
        {toolCalls().length === 0 ? <text fg={peaTheme.textMuted}>No tool calls yet.</text> : null}
        {toolCalls().map((tool) => (
          <ToolCallRow tool={tool} active={tool.id === activeToolCallId()} />
        ))}
        {memories().length > 0 ? (
          <box flexDirection="column" paddingTop={1} gap={0}>
            <text fg={peaTheme.textMuted}>observational memory</text>
            {memories().map((entry) => (
              <text fg={peaTheme.thought}>{`${entry.status} ${entry.title ?? entry.kind}`}</text>
            ))}
          </box>
        ) : null}
        {debugEvents().length > 0 ? (
          <box flexDirection="column" paddingTop={1} gap={0}>
            <text fg={peaTheme.textMuted}>debug</text>
            {debugEvents().map((event) => (
              <DebugEventRow event={event} />
            ))}
          </box>
        ) : null}
      </scrollbox>
    </box>
  );
}

function ToolCallRow(props: { tool: WorkbenchToolCall; active: boolean }): JSX.Element {
  return (
    <box flexDirection="column" paddingBottom={1} gap={0}>
      <text fg={props.active ? peaTheme.primary : statusColor(props.tool.status)}>
        {`${props.active ? "▶ " : ""}${props.tool.status ?? "running"}`}
      </text>
      <text fg={peaTheme.text}>{props.tool.title}</text>
      {props.tool.content ? (
        <text fg={peaTheme.textMuted}>{truncate(props.tool.content, 220)}</text>
      ) : null}
      {props.tool.locations?.slice(0, 2).map((location) => (
        <text fg={peaTheme.textMuted}>{formatLocation(location)}</text>
      ))}
    </box>
  );
}

function DebugEventRow(props: { event: WorkbenchDebugEvent }): JSX.Element {
  return (
    <box flexDirection="column" paddingBottom={1} gap={0}>
      <text fg={peaTheme.textMuted}>{`${props.event.source}:${props.event.type}`}</text>
      {props.event.label ? <text fg={peaTheme.text}>{props.event.label}</text> : null}
    </box>
  );
}

function statusColor(status: WorkbenchToolCall["status"]): string {
  if (status === "completed") return peaTheme.success;
  if (status === "failed") return peaTheme.error;
  if (status === "pending") return peaTheme.warning;
  return peaTheme.tool;
}

function formatLocation(location: NonNullable<WorkbenchToolCall["locations"]>[number]): string {
  return `${location.path ?? location.uri ?? "location"}${location.line ? `:${location.line}` : ""}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
