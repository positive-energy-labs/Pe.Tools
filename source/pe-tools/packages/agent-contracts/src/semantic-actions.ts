import { instancesActions } from "./instances.ts";
import { scheduleActions } from "./schedule-actions.ts";
import { familyActions } from "./family-actions.ts";
import { takeoffsRouteState } from "./takeoffs.ts";
import { nativeProcessSchema } from "./action-receipts.ts";
import { z } from "zod";
import { executionTargetSchema } from "./target.ts";
import { workKeySchema } from "./route-state.ts";

/**
 * One record per Action. It projects to a button, a refusal, a chord, a help row, an agent tool,
 * a demo id and a host admission; nothing is declared twice.
 */
export interface ActionDefinition {
  /** One sentence for a stranger; the agent tool description and the help row. */
  says: string;
  /** A literal hotkey string, e.g. "mod+k". The shell registers it; the route never does. */
  chord?: string;
  /** The Reading keys this action invalidates on success. */
  dirties: readonly string[];
  needs: string;
  actor: "any" | "human";
  input: z.ZodType;
}

const item = z.object({ elementId: z.number().int(), name: z.string(), systemTag: z.string() });
const definitions = {
  "takeoffs.adopt": {
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    actor: "any",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
    executors: ["takeoffs.initialize-carrier", "takeoffs.adopt"],
    description: "Adopt selected regions using the submitted names and system tags.",
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
    executors: ["takeoffs.initialize-carrier", "takeoffs.partition"],
    description: "Prepare carriers and partition the selected adopted zone.",
  },
  "takeoffs.sync": {
    says:
      "Insert eligible rooms, preserve system/link behavior, and update linked staged rooms in RHVAC.",
    needs: "project-document",
    actor: "any",
    input: z.object({ path: z.string().min(1), zones: z.array(z.string()).default([]) }),
    dirties: ["snapshot", "rhvac-open"],
    executors: ["rhvac.sync", "takeoffs.rhvac-links"],
    description:
      "Insert eligible rooms, preserve system/link behavior, and update linked staged rooms in RHVAC.",
  },
  "takeoffs.room-type": {
    says: "Write an authored room type to the selected document.",
    needs: "project-document",
    actor: "any",
    input: z.object({ elementId: z.number().int(), roomType: z.string() }),
    dirties: ["snapshot"],
    executors: ["takeoffs.room-type"],
    description: "Write an authored room type to the selected document.",
  },
  "takeoffs.decisions": {
    says: "Write explicit review decisions to the selected document.",
    needs: "project-document",
    actor: "any",
    input: z.object({
      elementId: z.number().int(),
      resolutions: z.array(
        z.object({
          subject: z.string(),
          flag: z.string(),
          verb: z.enum(["accept", "dismiss"]),
          at: z.string(),
          runId: z.string(),
        }),
      ),
    }),
    dirties: ["snapshot"],
    executors: ["takeoffs.decisions"],
    description: "Write explicit review decisions to the selected document.",
  },
} as const;
export const takeoffActions = definitions;
export const semanticActions = {
  ...definitions,
  ...familyActions,
  ...instancesActions,
  ...scheduleActions,
};
export type SemanticActionKey = keyof typeof semanticActions;
export type TakeoffActionKey = keyof typeof definitions;
export const actionBasesSchema = z
  .object({
    captureId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    work: z
      .object({ key: workKeySchema, revision: z.number().int().nonnegative() })
      .optional(),
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
    says:
      "Read the original action and its individual file/native/publication outcomes without Revit.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: false,
    description:
      "Read the original action and its individual file/native/publication outcomes without Revit.",
  },
  "action.recover": {
    says:
      "Read durable native evidence for the original action; uncertain outcomes remain blocked.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: false,
    description:
      "Read durable native evidence for the original action; uncertain outcomes remain blocked.",
  },
  "action.resume": {
    says:
      "Explicitly authorize remaining effects of a recovered original action. Completed effects never repeat.",
    dirties: ["receipts"],
    needs: "nothing",
    actor: "any",
    input: z.object({ id: z.string().min(1) }),
    mutates: true,
    description:
      "Explicitly authorize remaining effects of a recovered original action. Completed effects never repeat.",
  },
} as const;
export type ActionControlKey = keyof typeof actionControls;

export const preparedTakeoffSchema = z.strictObject({
  process: nativeProcessSchema,
  staged: takeoffsRouteState.schema.shape.staged,
});
