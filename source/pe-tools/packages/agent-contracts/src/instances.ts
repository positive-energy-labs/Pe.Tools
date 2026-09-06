import { z } from "zod";
import type { RouteStateSpec } from "./route-state.ts";
import { sdkSessionSelectorSchema } from "./route-state.ts";

const documentSelector = z.string().trim().min(1);
export const instancesDocumentSchema = z.object({
  selectedSession: sdkSessionSelectorSchema.nullable().default(null),
  staged: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("open"),
        session: sdkSessionSelectorSchema,
        document: documentSelector,
      }),
      z.object({
        kind: z.literal("start"),
        year: z.string().regex(/^20\d{2}$/),
        name: z.string().max(64),
        document: documentSelector.optional(),
      }),
    ])
    .nullable()
    .default(null),
  observation: z.json().nullable().default(null),
  outcome: z
    .object({ action: z.string(), at: z.string(), receipt: z.json() })
    .nullable()
    .default(null),
});
export type InstancesDocument = z.infer<typeof instancesDocumentSchema>;
export const instancesRouteState = {
  route: "instances",
  scope: "workspace",
  title: "Instances",
  description:
    "Select Revit sessions and stage documents. Refresh to discover installed years, sessions and recents. Stage then open or start. Other lifecycle commands are human-only.",
  schema: instancesDocumentSchema,
  agentWriteMask: [["selectedSession"], ["staged"]],
  commands: {
    refresh: {
      description: "Read SDK sessions, installed years and recent documents.",
      input: z.object({}),
      actor: "any",
    },
    open: {
      description: "Open or activate the staged document in its exact session.",
      input: z.object({}),
      actor: "any",
      mutatesExternal: true,
    },
    start: {
      description: "Start installed Revit with the staged year, name and optional document.",
      input: z.object({}),
      actor: "any",
      mutatesExternal: true,
    },
    restart: {
      description: "Restart the selected session.",
      input: z.object({}),
      actor: "human",
      mutatesExternal: true,
    },
    stop: {
      description: "Stop the selected session.",
      input: z.object({ force: z.boolean().default(false) }),
      actor: "human",
      mutatesExternal: true,
    },
    recover: {
      description:
        "After inspecting Revit and SDK receipts, acknowledge an uncertain operation before another mutation.",
      input: z.object({ inspected: z.literal(true) }),
      actor: "human",
      recoversExternal: true,
    },
    close: {
      description: "Close a document in the selected session with an explicit SDK close intent.",
      input: z.object({ document: documentSelector, intent: z.string().min(1) }),
      actor: "human",
      mutatesExternal: true,
    },
  },
} satisfies RouteStateSpec<typeof instancesDocumentSchema>;
