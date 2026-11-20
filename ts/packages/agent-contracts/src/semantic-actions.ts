import { commandTable } from "./command-axes.ts";
import { sheetCommands } from "./slots/sheet-command.ts";
import {
  roomsViewId,
  roomRegionUniqueId,
  stagedRoomWrites,
  roomsRouteState as roomsWorkSchema,
} from "./rooms.ts";
import { workIntent, workWriteCommands } from "./write-intent.ts";
import { instancesActions, instancesReading, instancesSessionSelection } from "./instances.ts";
import { scheduleReads } from "./schedule-actions.ts";
import { familyActions, familyReads } from "./family-actions.ts";
import { stagedRoomEditSchema } from "./takeoffs.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { isReadEffect } from "@pe/host-contracts/contracts";

import type { Command } from "./command.ts";
export type { ActionNeed } from "./command.ts";
const item = z.object({
  elementId: z.number().int(),
  uniqueId: z.string().min(1),
  name: z.string(),
  systemTag: z.string(),
});
const point = z.tuple([z.number(), z.number()]);
const loop = z.array(point).min(3);
const roomNumber = z.number().optional();
const definitions = {
  "takeoffs.initialize": {
    native: ["takeoffs.initialize-carrier"],
    says: "Write the shared parameters this document is missing before any takeoff runs.",
    needs: "project-document",
    effect: "command",
    input: z.object({ stage: z.string().min(1) }),
    dirties: ["snapshot"],
  },
  "takeoffs.adopt": {
    native: ["takeoffs.record-replacements", "takeoffs.initialize-carrier", "takeoffs.adopt"],
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
  },
  "takeoffs.partition": {
    native: ["takeoffs.record-replacements", "takeoffs.partition"],
    says: "Partition the selected adopted zone.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      zoneRegion: z.number().int(),
      view: z.string(),
      zoneName: z.string(),
      zoneUniqueId: z.string(),
      runId: z.string().optional(),
    }),
    dirties: ["snapshot", "takeoff-views"],
  },
  "takeoffs.sync": {
    native: [
      "takeoffs.record-replacements",
      "takeoffs.rhvac-links.preflight",
      "takeoffs.rhvac-links",
    ],
    says: "Insert eligible rooms, preserve system/link behavior, and update linked staged rooms in RHVAC.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      path: z.string().min(1),
      zones: z.array(z.string()).default([]),
      captureId: z.string().min(1),
      fileVersion: z.string().min(1),
    }),
    dirties: ["snapshot", "rhvac-open"],
  },
  "rooms.partition": {
    native: ["takeoffs.record-replacements", "rooms.partition"],
    says: "Partition every zone on a plan selected by numeric Revit view id, keeping locked and matched rooms.",
    needs: "project-document",
    effect: "command",
    // rejected: standing "not a room" rings (model feet, outer only); a face at IoU >= 0.6 is held `rejected`.
    input: z.object({ view: roomsViewId, rejected: z.array(loop).optional() }),
    dirties: ["snapshot"],
  },
  "rooms.draw": {
    native: ["takeoffs.record-replacements", "rooms.draw"],
    says: "Draw one room (locked) or zone region from loops on a plan selected by numeric Revit view id.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      view: z
        .int({
          error: (issue) =>
            issue.input === undefined
              ? "No room draw is staged with a plan view. Nothing was written."
              : "Choose a plan view.",
        })
        .positive({ error: "Choose a plan view." })
        .meta({ description: "Choose a plan view by its Revit view id." }),
      loops: z.array(loop).min(1),
      name: z.string().nullable().optional(),
      role: z.enum(["room", "zone"]).optional(),
    }),
    dirties: ["snapshot"],
  },
  "rooms.write": {
    native: ["takeoffs.record-replacements", "rooms.write"],
    says: "Write room fields by FilledRegion UniqueId and confirm each cell read back after commit.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      regions: z
        .array(
          z.object({
            uniqueId: roomRegionUniqueId,
            name: z.string().optional(),
            type: z.string().optional(),
            ceilingFt: roomNumber,
            people: roomNumber,
            lightingW: roomNumber,
            equipSensible: roomNumber,
            equipLatent: roomNumber,
            ventilationCfm: roomNumber,
            role: z.enum(["room", "zone"]).optional(),
          }),
        )
        .min(1),
    }),
    dirties: ["snapshot"],
  },
  "rooms.merge": {
    native: ["takeoffs.record-replacements", "rooms.merge"],
    says: "Combine two or more touching rooms of one zone on a plan selected by numeric Revit view id into one locked room.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      view: roomsViewId,
      uniqueIds: z.array(roomRegionUniqueId).min(2),
      name: z.string().nullable().optional(),
    }),
    dirties: ["snapshot"],
  },
} as const;
export const takeoffActions = definitions;

export type TakeoffActionKey = keyof typeof definitions;
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
import { takeoffsRouteState } from "./takeoffs.ts";
import { roomsRouteState } from "./rooms.ts";
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
  takeoffs: {
    name: "takeoffs",
    says: takeoffsRouteState.description,
    work: {
      ...takeoffsRouteState,
      editable: [
        ["writeIntent", "*"],
        ["edits", "*"],
        ["decisions", "*"],
      ],
    },
    commands: {
      ...workWriteCommands("takeoffs", "takeoffs.initialize", definitions["takeoffs.initialize"]),
      ...workWriteCommands("takeoffs", "takeoffs.adopt", definitions["takeoffs.adopt"]),
      ...workWriteCommands("takeoffs", "takeoffs.partition", definitions["takeoffs.partition"]),
      ...workWriteCommands("takeoffs", "takeoffs.sync", definitions["takeoffs.sync"]),
    },
  },
  rooms: {
    name: "rooms",
    says: roomsRouteState.description,
    work: {
      ...roomsRouteState,
      editable: [
        ["writeIntent", "*"],
        ["edits", "*"],
        ["marks", "*"],
      ],
    },
    commands: {
      ...workWriteCommands("rooms", "rooms.partition", definitions["rooms.partition"]),
      ...workWriteCommands("rooms", "rooms.draw", definitions["rooms.draw"]),
      ...workWriteCommands(
        "rooms",
        "rooms.write",
        {
          ...definitions["rooms.write"],
          input: definitions["rooms.write"].input,
        },
        { derive: (work) => ({ regions: stagedRoomWrites(roomsWorkSchema.schema.parse(work)) }) },
      ),
      ...workWriteCommands("rooms", "rooms.merge", definitions["rooms.merge"]),
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
  ...sheetCommands,
  ...builtinTools.pods.commands,
  ...builtinTools.families.commands,
  ...builtinTools.takeoffs.commands,
  ...builtinTools.rooms.commands,
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

/**
 * Submitted Takeoffs edits and verdicts from either author. Optional suggestions are review
 * content and do not enter execution until explicitly taken into the shared edit.
 */
export const preparedTakeoffSchema = z.strictObject({
  process: nativeProcessSchema,
  edits: z.record(z.string(), stagedRoomEditSchema),
  decisions: z.record(z.string(), z.enum(["accept", "dismiss"])),
});

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
