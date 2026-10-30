import { pane, split, type RouteGraph } from "@pe/agent-contracts";
import { selectedMember } from "./model";
import type { PodsPage } from "./page";

export const podsReadings = {
  pods: { kind: "use", source: "pods.list", retire: "page", args: (p) => [p.demo, p.live] },
  member: {
    kind: "use",
    source: "pods.member",
    retire: "page",
    args: (p) => [selectedMember(p), p.demo, p.live],
  },
  status: { kind: "use", source: "pods.status", retire: "page", args: (p) => [p.demo, p.live] },
  composition: {
    kind: "use",
    source: "pods.composition",
    deps: ["member", "status"],
    retire: "target",
  },
  runs: {
    kind: "use",
    source: "pods.runs",
    retire: "page",
    args: (p) => [selectedMember(p), p.pod, p.runs, p.demo, p.live],
  },
  plugins: {
    kind: "use",
    source: "pods.plugins",
    retire: "page",
    args: (p) => [p.demo, p.live, p.pluginEpoch],
  },
} satisfies RouteGraph<PodsPage>["readings"];

export const podsPanes = {
  members: {
    label: "members",
    purpose: "Browse every installed Pod member and activate its plugin",
    draws: ["pods", "plugins"],
    verbs: [],
  },
  spec: {
    label: "spec",
    purpose: "Edit raw JSON or the schema form and review field proposals",
    draws: ["member", "composition"],
    verbs: [],
  },
  runs: {
    label: "runs",
    purpose: "Inspect the member's receipts or every run in its Pod",
    draws: ["runs", "pods"],
    verbs: [],
  },
  history: {
    label: "History",
    purpose: "Inspect this Work's verb timeline",
    draws: [],
    verbs: [],
    history: {},
  },
} satisfies RouteGraph["panes"];
export const podsLayout = split(
  "members",
  { axis: "h", sized: "start", size: 300, minSize: 220, persist: "pods:members" },
  pane("members"),
  split(
    "runs",
    { axis: "h", sized: "end", size: 300, minSize: 220, persist: "pods:runs" },
    pane("spec"),
    split("history", { axis: "v", sized: "end", size: 180 }, pane("runs"), pane("history")),
  ),
);
