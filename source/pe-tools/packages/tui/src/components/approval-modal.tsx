import type { JSX } from "@opentui/solid";
import type { WorkbenchApprovalOption, WorkbenchApprovalRequest } from "@pe/agent-contracts";
import { peaTheme } from "../theme.js";

export function ApprovalModal(props: {
  approval?: WorkbenchApprovalRequest;
  selectedOptionId?: string;
  expanded: boolean;
  onSelect: (optionId: string) => void;
  onToggleExpanded: () => void;
}): JSX.Element | null {
  const approval = props.approval;
  if (!approval) return null;

  return (
    <box
      position="absolute"
      left={4}
      right={4}
      bottom={6}
      flexDirection="column"
      backgroundColor={peaTheme.backgroundPanel}
      border
      borderColor={peaTheme.warning}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={peaTheme.warning}>approval required</text>
        <text fg={peaTheme.textMuted}>{approval.toolCall.status ?? "pending"}</text>
      </box>
      <text fg={peaTheme.text}>{approval.toolCall.title}</text>
      {approval.toolCall.content ? (
        <text fg={peaTheme.textMuted}>{approval.toolCall.content}</text>
      ) : null}
      {props.expanded ? (
        <box
          flexDirection="column"
          backgroundColor={peaTheme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={peaTheme.textMuted}>input</text>
          <text fg={peaTheme.text}>{formatUnknown(approval.toolCall.rawInput)}</text>
          {approval.toolCall.rawOutput !== undefined ? (
            <box flexDirection="column">
              <text fg={peaTheme.textMuted}>output</text>
              <text fg={peaTheme.text}>{formatUnknown(approval.toolCall.rawOutput)}</text>
            </box>
          ) : null}
        </box>
      ) : null}
      <box flexDirection="row" gap={2}>
        {approval.options.map((option) => (
          <ApprovalOption
            option={option}
            selected={option.optionId === props.selectedOptionId}
            onSelect={() => props.onSelect(option.optionId)}
          />
        ))}
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={peaTheme.textMuted}>
          ←/→ select · enter confirm · y once · a always · n reject · d detail
        </text>
        <text fg={peaTheme.primary} onMouseDown={props.onToggleExpanded}>
          {props.expanded ? "hide detail" : "show detail"}
        </text>
      </box>
    </box>
  );
}

function ApprovalOption(props: {
  option: WorkbenchApprovalOption;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <box
      border
      borderColor={props.selected ? peaTheme.primary : peaTheme.border}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? peaTheme.backgroundElement : peaTheme.backgroundPanel}
      onMouseDown={props.onSelect}
    >
      <text fg={props.selected ? peaTheme.primary : peaTheme.text}>
        {optionLabel(props.option)}
      </text>
    </box>
  );
}

function optionLabel(option: WorkbenchApprovalOption): string {
  if (option.kind === "allow_once") return "allow once";
  if (option.kind === "allow_always") return "allow always";
  if (option.kind === "reject_once") return "reject";
  return option.name;
}

function formatUnknown(value: unknown): string {
  if (value === undefined) return "<empty>";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "<unserializable>";
  }
}
