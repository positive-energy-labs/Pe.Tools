import { fansRouteState } from "./generated/fans-work.ts";
import { stagedRoomWrites, roomsRouteState as roomsWorkSchema } from "./rooms.ts";
import { workIntent, workWriteCommands } from "./write-intent.ts";
import { instancesActions, instancesReading, instancesSessionSelection } from "./instances.ts";
import { scheduleActions, scheduleReads } from "./schedule-actions.ts";
import { familyActions, familyReads } from "./family-actions.ts";
import { stagedRoomEditSchema } from "./takeoffs.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";

import type { Command } from "./command.ts";
export type { ActionNeed } from "./command.ts";
const item = z.object({ elementId: z.number().int(), name: z.string(), systemTag: z.string() });
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
    native: ["takeoffs.initialize-carrier", "takeoffs.adopt"],
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    effect: "command",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
  },
  "takeoffs.partition": {
    native: ["takeoffs.initialize-carrier", "takeoffs.partition"],
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
    native: ["takeoffs.rhvac-links"],
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
    native: ["takeoffs.initialize-carrier", "rooms.partition"],
    says: "Partition every zone drawn on one plan view into rooms, keeping locked and matched rooms.",
    needs: "project-document",
    effect: "command",
    // rejected: standing "not a room" rings (model feet, outer only); a face at IoU >= 0.6 is held `rejected`.
    input: z.object({ view: z.string().min(1), rejected: z.array(loop).optional() }),
    dirties: ["snapshot"],
  },
  "rooms.draw": {
    native: ["takeoffs.initialize-carrier", "rooms.draw"],
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
    native: ["takeoffs.initialize-carrier", "rooms.write"],
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
    native: ["takeoffs.initialize-carrier", "rooms.merge"],
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

export const ductsActions = {
  "ducts.refresh": {
    says: "Read this document's duct snapshots and pricing inputs again.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
  "ducts.plan-losses": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.tables", "ducts.apply.plan"],
    says: "Pass the route:ducts Work handle { key, revision } as the primary work argument. Separately, stage the fan walk { unitId, portIndex } from route:reads.value (read fans.roster) in route:fans writeIntent; the plan reads sibling Fans Work at the same document, or readWorks.fans. Fan write cells are derived from that walk and staged edits. Stage writeIntent.cells in Ducts Work only to limit rule writes. Then plan the staged duct loss writes (fitting coefficients, terminal and component drops, fan static) and report each write's outcome without changing Revit.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.apply-losses": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.tables", "ducts.apply"],
    says: "Stage writeIntent.cells to limit this write to the requested rule cells. Omit cells only for a whole-network write that was explicitly reviewed. Write the staged duct loss values to Revit (fitting coefficients, terminal and component drops, fan static) and record their provenance in Project Information.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
  "ducts.plan-heal": {
    // The host derives the plan from these Reads; it opens no transaction and calls no rehearsal.
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster"],
    says: "Plan healing the staged duct groups: derive each group's repairs (cap dangling open ends, connect coincident same-size ends, close same-size gaps of at most 3 in) from Work and seal them, without opening a transaction. Show the person the planned items before any apply.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.rehearse-heal": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.heal.preview"],
    says: "Optionally rehearse the planned heal in Revit: runs every repair and Pe's post-check, then rolls all of it back. Refused on a workshared model before any transaction. A rehearsal never arms apply; plan does.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.apply-heal": {
    native: ["ducts.snapshot.walk", "ducts.snapshot.roster", "ducts.heal"],
    says: "Heal duct groups in Revit, one transaction per group, with exactly the items a plan showed and a person approved; an item failing Pe's post-check is refused and rolled back. Revit gives rebuilt elements new ids: read the duct snapshot again after.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
    dirties: ["snapshot"],
  },
  "ducts.plan-assign-fan": {
    // The host derives the plan from these Reads; it opens no transaction and calls no rehearsal.
    native: ["ducts.snapshot.walk"],
    says: "Plan making the staged unit the fan of a duct system (Duct Systems > Select Equipment: the system's base equipment): read the system and seal the request, without opening a transaction. Show the person the plan before any apply.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.rehearse-assign-fan": {
    native: ["ducts.snapshot.walk", "ducts.assign-fan.preview"],
    says: "Optionally rehearse the planned fan assignment in Revit: runs Pe's guards, the write and its read back, then rolls it back. Refuses a system that already has base equipment, a unit with no port of the system's air classification, and a workshared model before any transaction. A rehearsal never arms apply; plan does.",
    needs: "project-document",
    effect: "query",
    input: z.strictObject({}),
    dirties: [],
  },
  "ducts.apply-assign-fan": {
    native: ["ducts.snapshot.walk", "ducts.assign-fan"],
    says: "Make a unit the base equipment (the fan) of a duct system in Revit, as a plan showed and a person approved; the system keeps its id, name and type. Read the duct snapshot again after: the unit's role reads base equipment of that system.",
    needs: "project-document",
    effect: "command",
    input: z.strictObject({}),
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
import { scheduleGridRouteState } from "./schedule-grid-data.ts";
import { takeoffsRouteState } from "./takeoffs.ts";
import { roomsRouteState } from "./rooms.ts";
import { ductsRouteState } from "./ducts.ts";
import { catalogWorkCommands } from "./catalog-work.ts";
/** Ducts derives its native request from the whole staged Work, not one writeIntent cell. */
const ductsDerive = (work: unknown) =>
  ductsRouteState.schema.parse(work);
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
    work: {
      ...familyDraftRouteState,
      editable: [
        ["writeIntent", "*"],
        ["cells", "*"],
      ],
    },
    commands: {
      "family.attach-spec": workCommand("family", familyActions["family.attach-spec"]),
      "family.observe": workCommand("family", familyActions["family.observe"], { optional: true }),
      ...workIntent("family", "family.capture", familyActions["family.capture"]),
      "family.plan": workCommand("family", familyActions["family.plan"]),
      ...workWriteCommands("family", "family.apply", familyActions["family.apply"]),
      ...workWriteCommands("family", "family.build", familyActions["family.build"]),
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
  schedules: {
    name: "schedules",
    says: scheduleGridRouteState.description,
    work: {
      ...scheduleGridRouteState,
      editable: [
        ["writeIntent", "*"],
        ["cells", "*"],
      ],
    },
    commands: {
      "schedule.grid.read": scheduleActions["schedule.grid.read"],
      "schedule.grid.bind": scheduleActions["schedule.grid.bind"],
      ...workWriteCommands(
        "schedules",
        "schedule.grid.push",
        scheduleActions["schedule.grid.push"],
        { workspace: true },
      ),
      ...workIntent("schedules", "schedule.capture", scheduleActions["schedule.capture"]),
      ...workWriteCommands("schedules", "schedule.apply", scheduleActions["schedule.apply"]),
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
      ...workIntent("takeoffs", "takeoffs.initialize", definitions["takeoffs.initialize"]),
      ...workWriteCommands("takeoffs", "takeoffs.adopt", definitions["takeoffs.adopt"]),
      ...workWriteCommands("takeoffs", "takeoffs.partition", definitions["takeoffs.partition"]),
      ...workIntent("takeoffs", "takeoffs.sync", definitions["takeoffs.sync"]),
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
  fans: {
    name: "fans", says: fansRouteState.description,
    work: { ...fansRouteState, editable: [
      ["writeIntent"], ["calculation", "*"], ["terminalDrops", "*"], ["componentDrops", "*"],
      ["esp", "*"], ["equipmentFlows", "*"], ["roles", "*"], ["flows", "*"], ["parameters", "*"], ["designFriction"],
    ] }, commands: {},
  },
  ducts: {
    name: "ducts",
    says: ductsRouteState.description,
    work: {
      ...ductsRouteState,
      editable: [
        ["writeIntent"],
        ["assumptions", "*"],
        ["rules", "*"],
        ["catalogs", "*"],
        ["ruleAssignments", "*"],
        ["subject", "*"],
        ["claims", "*"],
        ["labelParameter"],
        ["workingPhase"],
        ["systemColours"],
        ["kinds", "*"],
        ["criteria"],
      ],
    },
    commands: {
      "ducts.refresh": ductsActions["ducts.refresh"],
      ...workWriteCommands("ducts", "ducts.apply-losses", ductsActions["ducts.apply-losses"], {
        derive: ductsDerive,
        preview: { key: "ducts.plan-losses", definition: ductsActions["ducts.plan-losses"] },
      }),
      ...workWriteCommands("ducts", "ducts.apply-heal", ductsActions["ducts.apply-heal"], {
        derive: ductsDerive,
        preview: { key: "ducts.plan-heal", definition: ductsActions["ducts.plan-heal"] },
      }),
      // A rehearsal derives the same request from Work but is no plan: it carries no seal and cannot arm apply.
      ...workIntent("ducts", "ducts.rehearse-heal", ductsActions["ducts.rehearse-heal"], { derive: ductsDerive }),
      ...workIntent("ducts", "ducts.rehearse-assign-fan", ductsActions["ducts.rehearse-assign-fan"], { derive: ductsDerive }),
      ...workWriteCommands(
        "ducts",
        "ducts.apply-assign-fan",
        ductsActions["ducts.apply-assign-fan"],
        {
          derive: ductsDerive,
          preview: { key: "ducts.plan-assign-fan", definition: ductsActions["ducts.plan-assign-fan"] },
        },
      ),
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
  "work.start": {
    says:"Start this Work", needs:"nothing", effect:"command", dirties:[],
    input:z.object({key:workKeySchema,seed:z.json()}),
    axes:{subject:"None",touches:["Metadata"],effect:"SessionWrite",cost:"Mutation",cardinality:"One"},
  } as const,
  ...catalogWorkCommands,
  ...tools.pods.commands,
  ...tools.family.commands,
  ...tools.families.commands,
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
export type SemanticPreviewKey = {
  [K in SemanticActionKey]: (typeof commands)[K] extends { writeBoundary: { phase: "preview" } }
    ? K
    : never;
}[SemanticActionKey];
/** The plan half of a Work write: its receipt is review evidence, never a commit. */
export function isWritePreviewKey(key: string): boolean {
  const command = commands[key as SemanticActionKey] as
    | { writeBoundary?: { phase: string } }
    | undefined;
  return command?.writeBoundary?.phase === "preview";
}
/** The preview entry a Work write seals at. */
export function writePreviewKey<K extends SemanticActionKey>(key: K): SemanticActionKey {
  const command = commands[key] as { writeBoundary?: { previewKey: string } };
  if (!command.writeBoundary) throw Error(`${key} is not a Work write`);
  return command.writeBoundary.previewKey as SemanticActionKey;
}
