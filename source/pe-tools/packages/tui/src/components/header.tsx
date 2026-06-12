import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type { WorkbenchState } from "@pe/workbench-core";
import { peaTheme } from "../theme.js";

export function Header(props: { title?: string; state: Accessor<WorkbenchState> }): JSX.Element {
  const agentTitle = createMemo(
    () => props.state().agent?.title ?? props.state().agent?.name ?? "agent",
  );
  const sessionTitle = createMemo(
    () => props.state().session?.title ?? props.state().session?.sessionId ?? "no session",
  );
  const modelTitle = createMemo(() => props.state().model.currentModelId ?? "model unset");
  const modeTitle = createMemo(() => props.state().sessionMode.currentModeId ?? "default");

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={peaTheme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      border={["bottom"]}
      borderColor={peaTheme.border}
    >
      <text fg={peaTheme.primary}>{props.title ?? "Pea"}</text>
      <text fg={peaTheme.textMuted}>{agentTitle()}</text>
      <text fg={statusColor(props.state().status)}>{props.state().status}</text>
      <text fg={peaTheme.textMuted}>{sessionTitle()}</text>
      <text fg={peaTheme.textMuted}>{modelTitle()}</text>
      <text fg={peaTheme.textMuted}>{modeTitle()}</text>
    </box>
  );
}

function statusColor(status: WorkbenchState["status"]): string {
  if (status === "error") return peaTheme.error;
  if (status === "waiting") return peaTheme.warning;
  if (status === "running") return peaTheme.success;
  return peaTheme.textMuted;
}
