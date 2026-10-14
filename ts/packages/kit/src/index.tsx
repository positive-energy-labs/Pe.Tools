/** Spike: reuse the app's instruments verbatim. Moving their ownership needs the shell wave. */
export { createElement as h, useEffect, useReducer, useState } from "react";
export { createRoot } from "react-dom/client";
export { ArtifactFrame } from "../../../apps/web/src/components/lang/artifact-frame";
export { PaneTabs } from "../../../apps/web/src/components/lang/pane-tabs";
export { Code } from "../../../apps/web/src/components/lang/code";
export { Button } from "../../../apps/web/src/components/lang/button";
export { Input } from "../../../apps/web/src/components/lang/input";
export { Table } from "../../../apps/web/src/components/master-table/table";
export { ListPopup as Picker } from "../../../apps/web/src/components/lang/list-popup";
export { KeyScope } from "../../../apps/web/src/route/keys";

import { Code } from "../../../apps/web/src/components/lang/code";

/** The same sanitized, theme-aware Mermaid rendering that a code fence uses in the app. */
export function Mermaid({ source, title = "Diagram" }: { source: string; title?: string }) {
  return <Code code={source} lang="mermaid" title={title} />;
}
