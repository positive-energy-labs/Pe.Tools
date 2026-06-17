import { selectWorkbenchChrome } from "@pe/agent-projection";
import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type {
  WorkbenchMessage,
  WorkbenchMessagePart,
  WorkbenchPlanEntry,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/workbench-core";
import { peaTheme } from "../theme.js";
import { Logo } from "./logo.jsx";

export function Transcript(props: {
  state: Accessor<WorkbenchState>;
  localErrors: Accessor<string[]>;
}): JSX.Element {
  const messages = createMemo(() => props.state().transcript.messages);
  const toolCalls = createMemo(() => props.state().tools.calls);
  const plans = createMemo(() => props.state().plans.entries);
  const errors = createMemo(() => [
    ...props.state().uiStatus.errors.slice(-3),
    ...props.localErrors(),
  ]);
  const chrome = createMemo(() => selectWorkbenchChrome(props.state()));
  const empty = createMemo(() => messages().length === 0 && toolCalls().length === 0);

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
        <box flexDirection="column" alignItems="center" paddingTop={2} gap={1}>
          <Logo />
          <box flexDirection="row" gap={2} flexWrap="wrap" justifyContent="center">
            {chrome().featureCards.map((card) => (
              <box
                width={26}
                flexDirection="column"
                border
                borderColor={card.enabled ? peaTheme.borderActive : peaTheme.borderSubtle}
                backgroundColor={peaTheme.backgroundPanel}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={card.enabled ? peaTheme.primary : peaTheme.textMuted}>{card.title}</text>
                <text fg={peaTheme.textMuted}>{card.description}</text>
              </box>
            ))}
          </box>
        </box>
      ) : null}
      {messages().map((message) => (
        <MessageRow message={message} />
      ))}
      {toolCalls().length > 0 ? (
        <box paddingTop={1} gap={0}>
          <text fg={peaTheme.textMuted}>tool trace</text>
          {toolCalls()
            .slice(-12)
            .map((toolCall) => (
              <ToolCallRow toolCall={toolCall} />
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
      {props.message.parts.map((part) => (
        <text fg={partColor(part)}>{partText(part).trimEnd()}</text>
      ))}
    </box>
  );
}

function ToolCallRow(props: { toolCall: WorkbenchToolCall }): JSX.Element {
  return (
    <text fg={peaTheme.tool}>
      {`[${props.toolCall.status ?? "running"}] ${props.toolCall.title}${props.toolCall.content ? ` — ${props.toolCall.content}` : ""}`}
    </text>
  );
}

function PlanRow(props: { plan: WorkbenchPlanEntry }): JSX.Element {
  return <text fg={peaTheme.text}>{`[${props.plan.status}] ${props.plan.content}`}</text>;
}

function partText(part: WorkbenchMessagePart): string {
  if (part.kind === "text" || part.kind === "reasoning" || part.kind === "thought")
    return part.text;
  if (part.kind === "status") return part.text;
  if (part.kind === "error") return part.message;
  if (part.kind === "tool_call_ref" || part.kind === "tool_result_ref")
    return part.label ?? part.toolCallId;
  if (part.kind === "approval_ref") return part.label ?? part.approvalId;
  if (part.kind === "raw") return part.label ?? JSON.stringify(part.value);
  return "";
}

function partColor(part: WorkbenchMessagePart): string {
  if (part.kind === "reasoning" || part.kind === "thought") return peaTheme.thought;
  if (part.kind === "error") return peaTheme.error;
  if (part.kind === "tool_call_ref" || part.kind === "tool_result_ref") return peaTheme.tool;
  if (part.kind === "approval_ref" || part.kind === "status") return peaTheme.warning;
  return peaTheme.text;
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
