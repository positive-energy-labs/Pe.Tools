import { selectWorkbenchChrome } from "@pe/agent-projection";
import type { JSX } from "@opentui/solid";
import { createMemo, type Accessor } from "solid-js";
import type { WorkbenchState } from "@pe/workbench-core";
import { peaTheme } from "../theme.js";

export function Header(props: { title?: string; state: Accessor<WorkbenchState> }): JSX.Element {
  const chrome = createMemo(() => selectWorkbenchChrome(props.state()));

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={peaTheme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      border={["bottom"]}
      borderColor={peaTheme.borderSubtle}
    >
      <box flexDirection="row" gap={1}>
        <text fg={peaTheme.primary}>{props.title ?? chrome().title}</text>
        <text fg={peaTheme.textMuted}>{chrome().subtitle}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={statusColor(chrome().status)}>{chrome().status}</text>
        <text fg={peaTheme.textMuted}>{chrome().threadLabel}</text>
        <text fg={peaTheme.textMuted}>{chrome().modelLabel}</text>
        <text fg={peaTheme.textMuted}>{chrome().modeLabel}</text>
      </box>
    </box>
  );
}

function statusColor(status: WorkbenchState["uiStatus"]["overall"]["status"]): string {
  if (status === "error") return peaTheme.error;
  if (status === "waiting" || status === "canceling") return peaTheme.warning;
  if (status === "running" || status === "starting") return peaTheme.success;
  return peaTheme.textMuted;
}
