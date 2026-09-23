import type { ActionReadingKey } from "./reading.ts";
import { instancesActions, instancesReading } from "./instances.ts";
import { scheduleActions, scheduleReads } from "./schedule-actions.ts";
import { familyActions, familyReads } from "./family-actions.ts";
import { stagedRoomEditSchema } from "./takeoffs.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";

/** The target an action must be admitted against. `nothing` runs on the host alone. */
export type ActionNeed =
  | "nothing"
  | "session"
  | "document"
  | "project-document"
  | "family-document";

/**
 * One record per host action. A browser verb, a help row, a refusal, an agent tool and a receipt
 * are projections of it (a browser verb names it by key: `RouteAction.does`); nothing is declared twice.
 */
export interface ActionDefinition {
  /** One sentence for a stranger; the agent tool description and the help row. */
  says: string;
  /** The Reading keys this action invalidates on success. */
  dirties: readonly ActionReadingKey[];
  needs: ActionNeed;
  actor: "any" | "human";
  input: z.ZodType;
}

const item = z.object({ elementId: z.number().int(), name: z.string(), systemTag: z.string() });
const definitions = {
  "takeoffs.initialize": {
    says: "Write the shared parameters this document is missing before any takeoff runs.",
    needs: "project-document",
    actor: "human",
    input: z.object({ stage: z.string().min(1) }),
    dirties: ["snapshot"],
  },
  "takeoffs.adopt": {
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    actor: "any",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
  },
  "takeoffs.partition": {
    says: "Prepare carriers and partition the selected adopted zone.",
    needs: "project-document",
    actor: "any",
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
    actor: "any",
    input: z.object({ path: z.string().min(1), zones: z.array(z.string()).default([]) }),
    dirties: ["snapshot", "rhvac-open"],
  },
} as const;
export const takeoffActions = definitions;
export const semanticActions = {
  ...definitions,
  ...familyActions,
  ...instancesActions,
  ...scheduleActions,
} satisfies Record<string, ActionDefinition>;
export type SemanticActionKey = keyof typeof semanticActions;
export type TakeoffActionKey = keyof typeof definitions;
export const actionBasesSchema = z
  .object({
    captureId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    work: z.object({ key: workKeySchema, revision: z.number().int().nonnegative() }).optional(),
    fileVersion: z.string().optional(),
  })
  .strict();
export const actionAdmissionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["operation", "workflow"]),
    key: z.string().min(1),
    actor: z.enum(["human", "agent"]),
    destination: executionTargetSchema,
    input: z.record(z.string(), z.unknown()),
    bases: actionBasesSchema.default({}),
  })
  .strict();
export type ActionAdmission = z.infer<typeof actionAdmissionSchema>;
export type ActionBases = z.infer<typeof actionBasesSchema>;

export const actionControls = {
  "action.read": {
    says: "Read the original action and its individual file/native/publication outcomes without Revit.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: false,
  },
  "action.recover": {
    says: "Read durable native evidence for the original action; uncertain outcomes remain blocked.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: false,
  },
  "action.resume": {
    says: "Explicitly authorize remaining effects of a recovered original action. Completed effects never repeat.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: true,
  },
  "action.cancel": {
    says: "Stop the running action at the operation's next checkpoint. Work already written to Revit stands.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: true,
  },
} as const satisfies Record<string, ActionDefinition & { mutates: boolean }>;
export type ActionControlKey = keyof typeof actionControls;

/**
 * What an admitted takeoffs action froze: the person's staged edits (per room) and staged flag
 * verdicts. Pea's proposals are never frozen here, so they can never reach a sync.
 */
export const preparedTakeoffSchema = z.strictObject({
  process: nativeProcessSchema,
  edits: z.record(z.string(), stagedRoomEditSchema),
  decisions: z.record(z.string(), z.enum(["accept", "dismiss"])),
});

/** Every host action a browser verb may name, and every row Pea may find. One key space. */
export const hostActions = {
  ...semanticActions,
  ...actionControls,
  ...familyReads,
  ...scheduleReads,
  "instances.read": instancesReading,
} satisfies Record<string, ActionDefinition>;
export type HostActionKey = keyof typeof hostActions;
