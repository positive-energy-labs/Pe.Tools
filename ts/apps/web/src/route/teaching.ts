import { declaredTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { DUCTS_TEACHING } from "#/ducts/proto/e/teaching";
export const SHELL_REGIONS = {
  navigation: {
    id: "navigation",
    label: "Global navigation",
    purpose: "Choose a tool, work or Pea thread. Tutorial explains the current tool.",
  },
  workspace: {
    id: "workspace",
    label: "Workspace",
    purpose:
      "The selected tool opens here after host admission. Document access requires a local or paired device.",
  },
} as const;
const SHELL_LAYOUT = {
  id: "shell",
  axis: "vertical",
  target: "start",
  size: 56,
  start: SHELL_REGIONS.navigation,
  end: SHELL_REGIONS.workspace,
} as const satisfies TeachingLayout;
export const STARTUP_TEACHING = declaredTeaching(SHELL_LAYOUT);
/** Single SPA index knows no requested route. First hydration always matches its public shell. */
export const referenceTeaching = (pathname: string) =>
  pathname === "/ducts" ? DUCTS_TEACHING : STARTUP_TEACHING;
