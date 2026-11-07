import { paneLayout } from "../route/defaults";
import { z } from "zod";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route, localId } from "../route/defaults.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

import { chatArgs, chatValue } from "../../../../packages/agent-contracts/src/chat-read.ts";
export const loaded = { ...hostRead(valueRead("chat.context", chatArgs, chatValue)), args: () => ({}) };
export const fields = { mode: field(z.enum(["threads", "world"]), "threads", "query") };
export type { ChatHandle } from "./context.generated";
export const threadIdentity = (thread: string) => localId("chat", thread);
export const chatLayout = {
  kind: "split",
  axis: "h",
  id: "chat-threads",
  sized: "start",
  size: 300,
  minSize: 240,
  minOtherSize: 80,
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
    summary: "The Pea agent workbench and context world inspector.",
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
  panes: {
    main: {
      title: "Pea",
      purpose: "Read and compose",
      draw: draw(() => import("./chat-drawing.tsx"), "ChatDrawing"),
    },
  },
  layout: paneLayout("main"),
});

/** RouteDock owns this retained surface; the URL uses the conversation address contract. */
export const router = { contract: "pea", dock: true } as const;
