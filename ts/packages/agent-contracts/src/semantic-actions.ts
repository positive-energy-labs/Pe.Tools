import { commandTable } from "./command-axes.ts";
import { workIntent, workWriteCommands } from "./write-intent.ts";
import { instancesActions, instancesReading, instancesSessionSelection } from "./instances.ts";
import { scheduleReads } from "./schedule-actions.ts";
import { familyActions, familyReads } from "./family-actions.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { isReadEffect } from "@pe/host-contracts/contracts";

import type { Command } from "./command.ts";
export type { ActionNeed } from "./command.ts";
export const actionAdmissionSchema = z.strictObject({
  id: z.string().min(1),
  key: z.string().min(1),
  target: executionTargetSchema,
  input: z.record(z.string(), z.unknown()),
});
export type ActionAdmission = z.infer<typeof actionAdmissionSchema>;
/**
 * Set on an admission POST that re-sends bytes an earlier POST may already have delivered (a lost
 * acknowledgement, a retained outbox). Carries the retained first-send UTC time. A discarded
 * journal refuses unknown admissions sent at or before its discard, or without a valid time.
 */
export const ADMISSION_RESEND_HEADER = "x-pe-admission-resend";

import { workCommand, type Tool } from "./command.ts";
import { settingsRouteState } from "./settings.ts";
import { familiesRouteState } from "./families.ts";
import { catalogWorkCommands } from "./catalog-work.ts";
import { findingsCommands, findingsWork } from "./slots/findings.ts";
export const builtinTools = {
  pods: {
    name: "pods",
    says: settingsRouteState.description,
    work: { ...settingsRouteState, editable: [["fields", "*"]] },
    commands: {
      "settings.observe": workCommand("pods", familyActions["settings.observe"]),
      "settings.write": workCommand("pods", familyActions["settings.write"]),
    },
  },
  families: {
    name: "families",
    says: familiesRouteState.description,
    work: {
      ...familiesRouteState,
      editable: [["writeIntent", "*"], ["cells", "*"], ["patch"], ["scope"]],
    },
    commands: {
      "families.read": familyActions["families.read"],
      "families.cancel-read": familyActions["families.cancel-read"],
      ...workIntent("families", "families.capture", familyActions["families.capture"]),
      "families.plan": workCommand("families", familyActions["families.plan"]),
      ...workWriteCommands("families", "families.apply", familyActions["families.apply"]),
      "families.save-draft": workCommand("families", familyActions["families.save-draft"]),
    },
  },
  // Slice 9 (findings): an implicit kernel module, route-free Work per document (ADR 0035 rule 9).
  findings: {
    name: "findings",
    says: findingsWork.description,
    work: findingsWork,
    commands: findingsCommands,
  },
  instances: {
    name: "instances",
    says: "Revit sessions and document lifecycle",
    commands: Object.fromEntries(
      Object.entries(instancesActions).map(([key, definition]) => [
        key,
        {
          ...definition,
          announce: true as const,
          target: (input: unknown) => {
            const selection = instancesSessionSelection(input);
            return selection
              ? { kind: "sdk-session" as const, selection }
              : { kind: "host" as const };
          },
        },
      ]),
    ) as {
      [K in keyof typeof instancesActions]: (typeof instancesActions)[K] & {
        announce: true;
        target(input: unknown): import("./target.ts").ExecutionTarget;
      };
    },
  },
} satisfies Record<string, Tool>;
export const builtinCommandHead = {
  "work.start": {
    catalogEffect: "SessionWrite",
    says: "Start this Work",
    needs: "nothing",
    effect: "command",
    dirties: [],
    input: z.object({ key: workKeySchema, seed: z.json() }),
  } as const,
  ...catalogWorkCommands,
};
export const builtinCommands = {
  ...builtinCommandHead,
  ...builtinTools.pods.commands,
  ...builtinTools.families.commands,
  ...builtinTools.findings.commands,
  ...builtinTools.instances.commands,
};
export function targetForCommand(
  actions: Readonly<Record<string, Command>>,
  key: string,
  input: Record<string, unknown>,
  document?: import("./target.ts").DocumentRef,
): import("./target.ts").ExecutionTarget {
  const command = Object.hasOwn(actions, key) ? actions[key] : undefined;
  if (command?.target) return command.target(input);
  if (command?.needs === "nothing") return { kind: "host" };
  if (document)
    return command?.needs === "session"
      ? { kind: "session", session: document.session }
      : { kind: "document", ref: document };
  throw Error(`Command '${key}' requires an exact target`);
}

export const actionControls = {
  "action.read": {
    via: { route: "actions.read" },
    catalogEffect: "Read",
    says: "Read the original action and its individual file/native/publication outcomes without Revit.",
    dirties: ["receipts"],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().min(1) }),
  },
  "action.cancel": {
    via: { route: "action.cancel" },
    catalogEffect: "SessionWrite",
    says: "Stop the running action at the operation's next checkpoint. Work already written to Revit stands.",
    dirties: ["receipts"],
    needs: "nothing",
    effect: "command",
    input: z.object({ id: z.string().min(1) }),
  },
} as const satisfies Record<string, Command>;
export type ActionControlKey = keyof typeof actionControls;

/** Discovery projects the same portable command contracts used by invocation. */
const hostActionHead = {
  "ops.read": {
    via: { route: "operation.call" },
    native: [...hostOpCatalog, ...tsOnlyOperationCatalog]
      .filter((op) => isReadEffect(op.effect))
      .map((op) => op.key),
    says: "Read one native operation through the guarded operation door.",
    needs: "nothing",
    effect: "query",
    dirties: [],
    input: z.object({
      op: z
        .object({
          key: z.string(),
          effect: z.string().refine(isReadEffect, "ops.read requires a native Read"),
        })
        .passthrough(),
      request: z.unknown(),
    }),
  } as const,
  "page.bind": {
    via: { route: "page.bind" },
    catalogEffect: "SessionWrite",
    says: "Bind a Page to its exact execution target.",
    needs: "nothing",
    effect: "command",
    dirties: [],
    input: z.object({ slug: z.string().min(1), binding: z.unknown() }),
  } as const,
} satisfies Record<string, Command>;
const hostActionTail = {
  ...actionControls,
  // These direct reads consume an owning Work just like journaled commands. The send door
  // projects its handle into the existing family transport's scope, outside the read payload.
  "family.saved": familyReads["family.saved"],
  "parameter-links.read": workCommand("parameter-links", familyReads["parameter-links.read"]),
  ...scheduleReads,
  "instances.read": instancesReading,
} satisfies Record<string, Command>;
export const withHostActions = <const C extends Record<string, Command>>(registered: C) => ({
  ...hostActionHead,
  ...registered,
  ...hostActionTail,
});
export const builtinHostActions = withHostActions(builtinCommands);
type PlannedRow = Extract<(typeof commandTable)[keyof typeof commandTable], { plan: string }>;
export type SemanticPreviewKey = PlannedRow["plan"];
const previews = new Set<string>(
  Object.values(commandTable).flatMap((row) => ("plan" in row ? [row.plan] : [])),
);
/** The plan half of a Work write: its receipt is review evidence, never a commit. */
export const isWritePreviewKey = (key: string): boolean => previews.has(key);
