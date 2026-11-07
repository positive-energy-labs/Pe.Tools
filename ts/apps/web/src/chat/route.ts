import { z } from "zod";
import { type Machine } from "@pe/agent-contracts";
import { valueRead } from "../../../../packages/agent-contracts/src/value.ts";
import { field, route, localId, split, type DrawContext } from "../route/typed-route.ts";
import { hostRead } from "../route/host-read.ts";
import { draw } from "../route/draw.tsx";

export const chatArgs = z.object({});
export const chatValue = z.object({ machine: z.custom<Machine>(), capabilities: z.unknown() });
const loaded = { ...hostRead(valueRead("chat.context", chatArgs, chatValue)), args: () => ({}) };
const fields = { mode: field(z.enum(["threads", "world"]), "threads", "query") };
export type ChatHandle = DrawContext<z.output<typeof chatValue>, typeof fields, never, never>;
export const threadIdentity = (thread: string) => localId("chat", thread);
export const chatLayout = split("h", ["threads", "chat"], { id: "chat-threads", sized: "start", size: 300, minSize: 240, persist: "pe.sideWidth" });
export const module = route({
  key: "chat", address: "/pea", name: "Pea", needs: "host", host: "./read.host.ts",
  directory: {
    group: "Ask / automate", summary: "The Pea agent workbench and context world inspector.", label: "Workbench", exposure: "Main",
    runtimeNeed: "Host for conversation; Revit depends on the requested capability", icon: "MessageSquare",
    aliases: ["chat", "agent", "assistant", "threads"], listed: true, satellites: [], surfaces: { web: "full", pwa: "full", tray: "compact" },
  },
  fields, core: loaded,
  panes: { main: { title: "Pea", purpose: "Read and compose", read: loaded, draw: draw(() => import("./chat-shell.tsx"), "ChatDrawing") } },
  layout: { kind: "pane", id: "main" },
});
