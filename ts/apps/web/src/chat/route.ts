import { read } from "../route/defaults";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { route } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import { chatArgs, chatValue } from "../../../../packages/agent-contracts/src/chat-read.ts";
export const loaded = read(hostRead(valueRead("chat.context", chatArgs, chatValue)));
export const fields = {};
export type { Context as ChatHandle } from "./context.generated";
/** `minOtherSize` is Pea's floor: the chat column's reading measure (`--chat-measure` in
 * chat-shell.css) between its two side lanes, in px at comfort density. Layout is data, so the
 * token-derived floor is fixed here; dense density folds the threads a little early. */
export const chatLayout = {
  kind: "split",
  axis: "h",
  id: "chat-threads",
  sized: "start",
  size: 300,
  minSize: 240,
  minOtherSize: 643,
  persist: "pe.sideWidth",
  children: [
    { kind: "pane", id: "threads" },
    { kind: "pane", id: "chat" },
  ],
} as const;
export const module = route({
  key: "chat",
  address: "/pea",
  name: "Pea",
  needs: "host",
  host: "../../../host/src/reads/chat.ts",
  directory: {
    group: "Ask / automate",
    summary: "The Pea agent workbench.",
    label: "Workbench",
    exposure: "Main",
    runtimeNeed: "Host for conversation; Revit depends on the requested capability",
    icon: "MessageSquare",
    aliases: ["chat", "agent", "assistant", "threads"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: "compact" },
  },
  fields,
  core: loaded,
  // Both bodies own their track (the roster's Scroll, the transcript's scroller), so both fill.
  panes: {
    threads: {
      title: "Threads",
      purpose: "Choose a conversation",
      body: "fill",
      draw: draw("fill", () => import("./chat-drawing.tsx"), "ThreadsDrawing"),
    },
    chat: {
      title: "Chat",
      purpose: "Read and compose",
      body: "fill",
      draw: draw("fill", () => import("./chat-drawing.tsx"), "ChatDrawing"),
    },
  },
  layout: chatLayout,
});

/** RouteDock owns this retained surface; the URL uses the conversation address contract. */
export const router = { contract: "pea", dock: true } as const;
