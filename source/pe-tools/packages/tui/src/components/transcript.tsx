import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type {
  WorkbenchMessage,
  WorkbenchPlanEntry,
  WorkbenchState,
  WorkbenchToolTrace,
} from "@pe/workbench-core";
import { peaTheme } from "../theme.js";

export function Transcript(props: {
  state: Accessor<WorkbenchState>;
  localErrors: Accessor<string[]>;
}): JSX.Element {
  const messages = createMemo(() => props.state().messages);
  const toolTraces = createMemo(() => props.state().toolTraces);
  const plans = createMemo(() => props.state().plans);
  const errors = createMemo(() => [...props.state().errors.slice(-3), ...props.localErrors()]);
  const empty = createMemo(() => messages().length === 0 && toolTraces().length === 0);

  return (
    <scrollbox
      flexGrow={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
      paddingLeft={1}
      paddingRight={1}
    >
      {empty() ? (
        <box paddingTop={1}>
          <text fg={peaTheme.textMuted}>Start a conversation with Pea.</text>
        </box>
      ) : null}
      {messages().map((message) => (
        <MessageRow message={message} />
      ))}
      {toolTraces().length > 0 ? (
        <box paddingTop={1} gap={0}>
          <text fg={peaTheme.textMuted}>tool trace</text>
          {toolTraces()
            .slice(-12)
            .map((trace) => (
              <ToolTraceRow trace={trace} />
            ))}
        </box>
      ) : null}
      {plans().length > 0 ? (
        <box paddingTop={1} gap={0}>
          <text fg={peaTheme.textMuted}>plan</text>
          {plans().map((plan) => (
            <PlanRow plan={plan} />
          ))}
        </box>
      ) : null}
      {errors().map((error) => (
        <text fg={peaTheme.error}>{`error: ${error}`}</text>
      ))}
    </scrollbox>
  );
}

function MessageRow(props: { message: WorkbenchMessage }): JSX.Element {
  return (
    <box paddingTop={1} gap={0}>
      <text fg={roleColor(props.message.role)}>{roleLabel(props.message.role)}</text>
      <text fg={peaTheme.text}>{props.message.text.trimEnd()}</text>
    </box>
  );
}

function ToolTraceRow(props: { trace: WorkbenchToolTrace }): JSX.Element {
  return (
    <text fg={peaTheme.tool}>
      {`[${props.trace.status ?? "running"}] ${props.trace.title}${props.trace.summary ? ` — ${props.trace.summary}` : ""}`}
    </text>
  );
}

function PlanRow(props: { plan: WorkbenchPlanEntry }): JSX.Element {
  return <text fg={peaTheme.text}>{`[${props.plan.status}] ${props.plan.content}`}</text>;
}

function roleLabel(role: WorkbenchMessage["role"]): string {
  if (role === "user") return "you";
  if (role === "assistant") return "pea";
  return role;
}

function roleColor(role: WorkbenchMessage["role"]): string {
  if (role === "user") return peaTheme.user;
  if (role === "assistant") return peaTheme.assistant;
  if (role === "thought") return peaTheme.thought;
  return peaTheme.textMuted;
}
