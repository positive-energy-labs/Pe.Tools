import { z } from "zod";
import { pane, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { podAdminAddress } from "../../../../packages/agent-contracts/src/routes/pod-admin";
import { pageVerb, rpcVerb } from "#/shell/verbs";
import { activationRpc, installInput, trustInput, installRpc, trustRpc } from "./sources";
export type AdminPage = { pod: string; epoch: number; selection: string };
const command = { caller: "human" as const, review: "shown" as const };
const lands = () => ({ epoch: Date.now() });
export const podAdminGraph: RouteGraph<AdminPage> = {
  key: "pod-admin",
  address: "pod-admin",
  name: "Pod administration",
  directory: {
    path: "/pod-admin",
    title: "Pod administration",
    label: "Pod administration",
    icon: "Settings2",
    category: "Ask / automate",
    exposure: "Preview",
    runtimeNeed: "Host",
    blurb: "Install Pods and manage activation and executable route trust.",
    aliases: ["install", "trust", "plugins"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  subjectField: {
    field: "pod",
    noun: "Pod",
    keyKind: "name",
    cardinality: "one",
    roster: "inventory",
    detail: "inventory",
    pane: "inventory",
    show: (id) => id,
  },
  fields: {
    selection: { ...field(z.string().default(""), {}), role: "selection" },
    pod: { ...podAdminAddress.fields.pod, role: "subject" },
    epoch: { ...field(z.number().default(0), {}), role: "transient", url: false },
  },
  readings: {
    inventory: { kind: "use", source: "pod-admin.inventory", retire: "page", args: (p) => p.epoch },
  },
  verbs: {
    select: pageVerb(
      { label: "Select Pod", input: z.object({ pod: z.string() }), effect: "query" },
      { page: (_, input) => input },
    ),
    activation: rpcVerb(
      activationRpc,
      { ...command, label: "Change activation", input: activationRpc.input },
      { intent: (_, input) => input, lands },
    ),
    install: rpcVerb(
      installRpc,
      { ...command, label: "Install Pod archive", input: installInput },
      { intent: (_, input) => input, lands },
    ),
    trust: rpcVerb(
      trustRpc,
      { ...command, label: "Change route trust", input: trustInput },
      { intent: (_, input) => input, lands },
    ),
  },
  panes: {
    inventory: {
      label: "Installed Pods",
      purpose: "Install and manage the selected Pod",
      draws: ["inventory"],
      verbs: [],
    },
  },
  layout: pane("inventory"),
  stageOrder: ["inventory"],
  stages: { inventory: { word: "Inventory", panes: ["inventory"], verbs: [] } },
  seeds: {
    inventory: {
      title: "Installed Pods",
      load: () => import("./seeds").then((m) => m.inventorySeed),
    },
  },
};
