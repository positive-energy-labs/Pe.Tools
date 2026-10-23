import * as React from "react";

export { React };
/** Shared instruments for the app and standalone Pages. */
export { createElement as h, useEffect, useReducer, useState } from "react";
export { createRoot } from "react-dom/client";
export { ArtifactFrame } from "./components/lang/artifact-frame";
export { Switcher } from "./components/lang/switcher";
export { Code } from "./components/lang/code";
export { Button } from "./components/lang/button";
export { Input } from "./components/lang/input";
export { Table } from "./components/master-table/table";
export { ListPopup as Picker } from "./components/lang/list-popup";
export { KeyScope } from "./keys";
export {
  useList,
  emptyListState,
  type ListState,
  type ListOptions,
  type ListController,
} from "./components/lang/collection";
export { ListView, ListBar, type ListRowParts } from "./components/lang/list-view";
export {
  SubjectText,
  SubjectTextContext,
  subjectDocument,
  type SubjectPart,
  type SubjectTextScope,
} from "./components/lang/subject-text";

import { Code } from "./components/lang/code";

/** The same sanitized, theme-aware Mermaid rendering that a code fence uses in the app. */
export function Mermaid({ source, title = "Diagram" }: { source: string; title?: string }) {
  return <Code code={source} lang="mermaid" title={title} />;
}

export { ThemeToggle } from "./components/lang/theme-toggle";
export { readTheme, writeTheme, useThemeMode, type ThemeMode } from "./theme";
export type { Column, TableState } from "./components/master-table/model";

export {
  Tooltip,
  TooltipHint,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./components/lang/tooltip";
export {
  Popover,
  PopoverTrigger,
  SubjectPopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from "./components/lang/popover";
export { HoverCard, HoverCardTrigger, HoverCardContent } from "./components/lang/hover-card";
