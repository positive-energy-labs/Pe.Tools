import * as contracts from "./contract.ts";
import type { ContextOf } from "../route/defaults";
import { z } from "zod";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared.ts";
import { textCodec } from "../../../../packages/agent-contracts/src/route-field.ts";
import { field } from "../route/defaults";
import { read } from "../route/defaults";
import { route } from "../route/defaults";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

export const loaded = read(hostRead(contracts.context));
export const fields = {
  ...threadListFields,
  turn: field(z.number().int().positive().optional(), undefined, "query"),
  prompt: { ...field(z.string().max(200), "", "query"), share: false as const, codec: textCodec },
};
export type ChatHandle = ContextOf<typeof fields, typeof loaded, never, never>;
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
  agent: false,
  address: "/pea",
  name: "Pea",
  needs: "host",
  host: "./host.ts",
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

/** RouteDock retains this ordinary route at /pea. */
export const router = { dock: true } as const;
