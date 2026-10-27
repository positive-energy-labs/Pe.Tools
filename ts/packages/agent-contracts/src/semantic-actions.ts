import { instancesActions, instancesReading, instancesSessionSelection } from "./instances.ts";
import { scheduleActions, scheduleReads } from "./schedule-actions.ts";
import { familyActions, familyReads } from "./family-actions.ts";
import { stagedRoomEditSchema } from "./takeoffs.ts";
import { ductsApplyInputSchema, ductsAssignFanInputSchema, ductsHealInputSchema } from "./ducts.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";

import type { Command } from "./command.ts";
export type { ActionNeed } from "./command.ts";
const item = z.object({ elementId: z.number().int(), name: z.string(), systemTag: z.string() });
const point = z.tuple([z.number(), z.number()]);
const loop = z.array(point).min(3);
const roomNumber = z.number().optional();
const definitions = {
  "takeoffs.initialize": {
    says: "Write the shared parameters this document is missing before any takeoff runs.",
    needs: "project-document",
    effect: "command",
    input: z.object({ stage: z.string().min(1) }),
    dirties: ["snapshot"],
  },
  "takeoffs.adopt": {
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
  },
  "takeoffs.partition": {
    says: "Prepare carriers and partition the selected adopted zone.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      zoneRegion: z.number().int(),
      view: z.string(),
      zoneName: z.string(),
      zoneGuid: z.string(),
      runId: z.string().optional(),
    }),
    dirties: ["snapshot", "takeoff-views"],
  },
  "takeoffs.sync": {
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
    says: "Partition every zone drawn on one plan view into rooms, keeping locked and matched rooms.",
    needs: "project-document",
    effect: "command",
    // rejected: standing "not a room" rings (model feet, outer only); a face at IoU >= 0.6 is held `rejected`.
    input: z.object({ view: z.string().min(1), rejected: z.array(loop).optional() }),
    dirties: ["snapshot"],
  },
  "rooms.draw": {
    says: "Draw one room (locked) or zone region from loops on a plan view.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      view: z.string().min(1),
      loops: z.array(loop).min(1),
      name: z.string().nullable().optional(),
      role: z.enum(["room", "zone"]).optional(),
    }),
    dirties: ["snapshot"],
  },
  "rooms.write": {
    says: "Write the given room fields, and a person's room or zone designation, onto regions by guid.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      regions: z
        .array(
          z.object({
            guid: z.string().min(1),
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
    says: "Combine two or more touching rooms of one zone on one plan view into one locked room.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      view: z.string().min(1),
      guids: z.array(z.string().min(1)).min(2),
      name: z.string().nullable().optional(),
    }),
    dirties: ["snapshot"],
  },
} as const;
export const takeoffActions = definitions;

/**
 * /ducts verbs: one native op, `ducts.apply`, once with `previewOnly` and once for real. Their own
 * keys, so `operations call ducts.apply` still names the native op.
 */
export const ductsActions = {
  "ducts.preview-losses": {
    native: ["ducts.apply"],
    says: "Plan the staged duct loss writes (fitting coefficients, terminal and component drops, fan static) and report each write's outcome without changing Revit.",
    needs: "project-document",
    effect: "query",
    input: ductsApplyInputSchema,
    dirties: [],
  },
  "ducts.apply-losses": {
    native: ["ducts.apply"],
    says: "Write the staged duct loss values to Revit (fitting coefficients, terminal and component drops, fan static) and record their provenance in Project Information.",
    needs: "project-document",
    effect: "command",
    input: ductsApplyInputSchema,
    dirties: ["snapshot"],
  },
  "ducts.preview-heal": {
    native: ["ducts.heal"],
    says: "Preview healing duct groups in Revit: cap dangling open ends, connect coincident same-size ends, close same-size gaps of at most 3 in; runs every repair and Pe's post-check, then rolls all of it back. Name a group without items to preview everything the Ducts route would heal there; show the person the per-item outcome before any apply.",
    needs: "project-document",
    effect: "query",
    input: ductsHealInputSchema,
    dirties: [],
  },
  "ducts.apply-heal": {
    native: ["ducts.heal"],
    says: "Heal duct groups in Revit, one transaction per group, with exactly the items a preview showed and a person approved; an item failing Pe's post-check is refused and rolled back. Revit gives rebuilt elements new ids: read the duct snapshot again after.",
    needs: "project-document",
    effect: "command",
    input: ductsHealInputSchema,
    dirties: ["snapshot"],
  },
  "ducts.preview-assign-fan": {
    native: ["ducts.assign-fan"],
    says: "Preview making a unit the fan of a duct system in Revit (Duct Systems > Select Equipment: the system's base equipment): runs Pe's guards, the write and its read back, then rolls it back. Refuses a system that already has base equipment, and a unit with no port of the system's air classification in that system or on its ducts. Show the person the outcome before any apply.",
    needs: "project-document",
    effect: "query",
    input: ductsAssignFanInputSchema,
    dirties: [],
  },
  "ducts.apply-assign-fan": {
    native: ["ducts.assign-fan"],
    says: "Make a unit the base equipment (the fan) of a duct system in Revit, as a preview showed and a person approved; the system keeps its id, name and type. Read the duct snapshot again after: the unit's role reads base equipment of that system.",
    needs: "project-document",
    effect: "command",
    input: ductsAssignFanInputSchema,
    dirties: ["snapshot"],
  },
} as const satisfies Record<string, Command>;
export type DuctsActionKey = keyof typeof ductsActions;

export type TakeoffActionKey = keyof typeof definitions;
export const actionAdmissionSchema = z.strictObject({
  id: z.string().min(1),
  key: z.string().min(1),
  target: executionTargetSchema,
  input: z.record(z.string(), z.unknown()),
});
export type ActionAdmission = z.infer<typeof actionAdmissionSchema>;

import { workCommand, type Tool } from "./command.ts";
import { settingsRouteState } from "./settings.ts";
import { familyDraftRouteState } from "./family.ts";
import { familiesRouteState } from "./families.ts";
import { parameterLinksRouteState } from "./parameter-links.ts";
import { scheduleGridRouteState } from "./schedule-grid-data.ts";
import { takeoffsRouteState } from "./takeoffs.ts";
import { roomsRouteState } from "./rooms.ts";
import { ductsRouteState } from "./ducts.ts";
export const tools = {
  pods: {
    name: "pods",
    says: settingsRouteState.description,
    work: { ...settingsRouteState, editable: [["fields", "*"]] },
    commands: {
      "settings.observe": workCommand("pods", familyActions["settings.observe"]),
      "settings.write": workCommand("pods", familyActions["settings.write"]),
    },
  },
  family: {
    name: "family",
    says: familyDraftRouteState.description,
    work: { ...familyDraftRouteState, editable: [["cells", "*"]] },
    commands: {
      "family.attach-spec": workCommand("family", familyActions["family.attach-spec"]),
      "family.observe": workCommand("family", familyActions["family.observe"], { optional: true }),
      "family.capture": workCommand("family", familyActions["family.capture"]),
      "family.plan": workCommand("family", familyActions["family.plan"]),
      "family.apply": workCommand("family", familyActions["family.apply"]),
      "family.build": workCommand("family", familyActions["family.build"]),
    },
  },
  families: {
    name: "families",
    says: familiesRouteState.description,
    work: { ...familiesRouteState, editable: [["cells", "*"], ["patch"], ["scope"]] },
    commands: {
      "families.capture": workCommand("families", familyActions["families.capture"]),
      "families.plan": workCommand("families", familyActions["families.plan"]),
      "families.apply": workCommand("families", familyActions["families.apply"]),
      "families.save-draft": workCommand("families", familyActions["families.save-draft"]),
    },
  },
  "parameter-links": {
    name: "parameter-links",
    says: parameterLinksRouteState.description,
    work: { ...parameterLinksRouteState, editable: [["profile"]] },
    commands: {
      "parameter-links.apply": workCommand(
        "parameter-links",
        familyActions["parameter-links.apply"],
      ),
    },
  },
  schedules: {
    name: "schedules",
    says: scheduleGridRouteState.description,
    work: { ...scheduleGridRouteState, editable: [["cells", "*"]] },
    commands: {
      "schedule.grid.push": workCommand("schedules", scheduleActions["schedule.grid.push"]),
      "schedule.capture": workCommand("schedules", scheduleActions["schedule.capture"]),
      "schedule.apply": workCommand("schedules", scheduleActions["schedule.apply"]),
    },
  },
  takeoffs: {
    name: "takeoffs",
    says: takeoffsRouteState.description,
    work: {
      ...takeoffsRouteState,
      editable: [
        ["edits", "*"],
        ["decisions", "*"],
      ],
    },
    commands: {
      "takeoffs.initialize": definitions["takeoffs.initialize"],
      "takeoffs.adopt": definitions["takeoffs.adopt"],
      "takeoffs.partition": definitions["takeoffs.partition"],
      "takeoffs.sync": workCommand("takeoffs", definitions["takeoffs.sync"]),
    },
  },
  rooms: {
    name: "rooms",
    says: roomsRouteState.description,
    work: {
      ...roomsRouteState,
      editable: [
        ["edits", "*"],
        ["marks", "*"],
      ],
    },
    commands: {
      "rooms.partition": workCommand("rooms", definitions["rooms.partition"]),
      "rooms.draw": workCommand("rooms", definitions["rooms.draw"]),
      "rooms.write": workCommand("rooms", definitions["rooms.write"]),
      "rooms.merge": workCommand("rooms", definitions["rooms.merge"]),
    },
  },
  ducts: {
    name: "ducts",
    says: ductsRouteState.description,
    work: {
      ...ductsRouteState,
      editable: [
        ["calculation", "*"],
        ["assumptions", "*"],
        ["rules", "*"],
        ["catalogs", "*"],
        ["ruleAssignments", "*"],
        ["terminalDrops", "*"],
        ["componentDrops", "*"],
        ["esp", "*"],
        ["equipmentFlows", "*"],
        ["roles", "*"],
        ["loads", "*"],
        ["flows", "*"],
        ["parameters", "*"],
        ["subject", "*"],
        ["claims", "*"],
        ["labelParameter"],
        ["workingPhase"],
        ["designFriction"],
        ["systemColours"],
      ],
    },
    commands: {
      "ducts.preview-losses": workCommand("ducts", ductsActions["ducts.preview-losses"]),
      "ducts.apply-losses": workCommand("ducts", ductsActions["ducts.apply-losses"]),
      "ducts.preview-heal": workCommand("ducts", ductsActions["ducts.preview-heal"]),
      "ducts.apply-heal": workCommand("ducts", ductsActions["ducts.apply-heal"]),
      "ducts.preview-assign-fan": workCommand("ducts", ductsActions["ducts.preview-assign-fan"]),
      "ducts.apply-assign-fan": workCommand("ducts", ductsActions["ducts.apply-assign-fan"]),
    },
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
export const commands = {
  ...tools.pods.commands,
  ...tools.family.commands,
  ...tools.families.commands,
  ...tools["parameter-links"].commands,
  ...tools.schedules.commands,
  ...tools.takeoffs.commands,
  ...tools.rooms.commands,
  ...tools.ducts.commands,
  ...tools.instances.commands,
};
export function commandTool(key: string): Tool | undefined {
  return Object.values(tools).find((tool) => Object.hasOwn(tool.commands, key));
}
export function commandTarget(
  key: string,
  input: Record<string, unknown>,
  document?: import("./target.ts").DocumentRef,
): import("./target.ts").ExecutionTarget {
  const command: Command | undefined = commands[key as keyof typeof commands];
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
    says: "Read the original action and its individual file/native/publication outcomes without Revit.",
    dirties: ["receipts"],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().min(1) }),
  },
  "action.recover": {
    says: "Read durable native evidence for the original action; uncertain outcomes remain blocked.",
    dirties: ["receipts"],
    needs: "nothing",
    effect: "query",
    input: z.object({ id: z.string().min(1) }),
  },
  "action.resume": {
    says: "Explicitly authorize remaining effects of a recovered original action. Completed effects never repeat.",
    dirties: ["receipts"],
    needs: "nothing",
    effect: "command",
    input: z.object({ id: z.string().min(1) }),
  },
  "action.cancel": {
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
export const hostActions = {
  ...commands,
  ...actionControls,
  ...familyReads,
  ...scheduleReads,
  "instances.read": instancesReading,
} satisfies Record<string, Command>;
export type HostActionKey = keyof typeof hostActions;
export type SemanticActionKey = keyof typeof commands;
