import { z } from "zod";
import { resolvedTargetSchema } from "./scope.ts";
import type { RouteStateSpec } from "./route-state.ts";

/**
 * Pods — the shareable scripting workspaces whose declared entrypoints become buttons in the
 * Revit Do palette. This document is where the user watches pea build the thing they will press.
 * The session every command runs in is the Scope the document is keyed under, never a field.
 */
const permissionMode = z.enum(["ReadOnly", "WriteTransaction", "NoTransaction"]).optional();
const timeoutSeconds = z.number().int().min(1).max(3600).optional();

const podsDocumentSchema = z.object({
  /** The pod in focus; commands default to it. */
  workspaceKey: z.string().trim().min(1).nullable().default(null),
  /** Last `refresh`: every pod manifest, its entrypoints, and its validation diagnostics. */
  pods: z.object({ at: z.iso.datetime(), value: z.json() }).nullable().default(null),
  /** Last `bootstrap`/`run`/`execute` receipt, with the target it actually ran against. */
  receipt: z
    .object({
      command: z.string(),
      at: z.iso.datetime(),
      target: resolvedTargetSchema,
      entrypoint: z.string().nullable(),
      value: z.json(),
    })
    .nullable()
    .default(null),
});
export type PodsDocument = z.infer<typeof podsDocumentSchema>;

const workspaceKeyInput = z
  .string()
  .optional()
  .describe(
    "Pod workspace key. Omit to use the document's workspaceKey, then the runtime default.",
  );

export const podsRouteState = {
  route: "pods",
  title: "Pods",
  description:
    "Pods are shareable Pe.Revit scripting workspaces; every declared entrypoint is a button in Revit's Do palette and a pod: row in pe_find. `refresh` lists every pod with its entrypoints and diagnostics — an invalid pod has no button. `bootstrap` creates or repairs a pod. `run` presses one declared entrypoint. `execute` runs inline C# for exploration only; promote anything worth repeating into an entrypoint.",
  schema: podsDocumentSchema,
  agentWriteMask: [["workspaceKey"]],
  commands: {
    refresh: {
      description:
        "List every pod workspace with its validated pod.json manifest, declared entrypoints, and diagnostics.",
      input: z.object({}),
      actor: "any",
    },
    bootstrap: {
      description:
        "Create or update a pod workspace: pod.json, project file, docs, and a sample entrypoint. User-authored files are preserved.",
      input: z.object({ workspaceKey: workspaceKeyInput }),
      actor: "any",
      mutatesExternal: true,
    },
    run: {
      description:
        "Press one declared entrypoint by id — the same code path as its Do palette button. Defaults to ReadOnly (changes rolled back); pass permissionMode WriteTransaction to keep edits.",
      input: z.object({
        entrypoint: z.string().min(1),
        workspaceKey: workspaceKeyInput,
        permissionMode,
        timeoutSeconds,
      }),
      actor: "any",
      mutatesExternal: true,
    },
    execute: {
      description:
        "Execute inline trusted C# for exploration. Prefer Execute-body statements; defaults to ReadOnly so active-document changes roll back. Use WriteTransaction for edits, NoTransaction only for APIs such as Document.SaveAs.",
      input: z.object({
        scriptContent: z.string().min(1),
        sourceName: z.string().optional(),
        workspaceKey: workspaceKeyInput,
        permissionMode,
        timeoutSeconds,
      }),
      actor: "any",
      mutatesExternal: true,
    },
  },
} satisfies RouteStateSpec<typeof podsDocumentSchema>;
