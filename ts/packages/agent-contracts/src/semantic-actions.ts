import type { ActionReadingKey } from "./reading.ts";
import { askLifetime } from "./thread.ts";
import { instancesActions } from "./instances.ts";
import { scheduleActions } from "./schedule-actions.ts";
import { familyActions } from "./family-actions.ts";
import { stagedRoomEditSchema } from "./takeoffs.ts";
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
  dirties: readonly ActionReadingKey[];
  needs: string;
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
    executors: ["takeoffs.initialize-carrier"],
  },
  "takeoffs.adopt": {
    says: "Adopt selected regions using the submitted names and system tags.",
    needs: "project-document",
    actor: "any",
    input: z.object({
      views: z.array(z.object({ view: z.string(), items: z.array(item).min(1) })).min(1),
    }),
    dirties: ["snapshot", "takeoff-views", "candidates"],
    executors: ["takeoffs.initialize-carrier", "takeoffs.adopt"],
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
  },
  "takeoffs.sync": {
    says: "Insert eligible rooms, preserve system/link behavior, and update linked staged rooms in RHVAC.",
    needs: "project-document",
    actor: "any",
    input: z.object({ path: z.string().min(1), zones: z.array(z.string()).default([]) }),
    dirties: ["snapshot", "rhvac-open"],
    executors: ["rhvac.sync", "takeoffs.rhvac-links"],
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

/** Browser-only verbs describe local Work and Page changes, not executable host workflows. */
export const browserActionSays = {
  chatCancel: `stops the running turn; its open asks expire, unanswered (an ask ${askLifetime})`,
  chatFork: "clones this thread, messages and all, and opens the clone",
  chatNew: "starts a new, empty thread and opens it",
  chatSend: "sends the composer's prompt to pea under the thread's admitted target",
  familiesSaveDraft:
    "Saves a copy of the staged draft into the chosen pod, one member per family, for the person to edit later. Optional: plan does not need it and still plans the staged cells' own bytes.",
  familiesScope: "Write the drafted categories, families and placement as the audited scope.",
  familyDismissBuild: "Dismiss the current reviewed build without changing the family profile.",
  familyPrepareBuild: "Review the exact saved family profile before building its .rfa.",
  familyRead:
    "Read the open family's spec from Revit into the draft; files nothing. Proposals stay.",
  instancesRefresh: "reacquire the SDK census, installed years and recents without changing Work",
  linksPreview: "Evaluate the shared draft and project its exact target writes.",
  linksProposal: "Evaluate Pea's proposed profile — a labelled preview that never arms apply.",
  linksRefresh:
    "Read the stored parameter links of the bound project without evaluating the draft.",
  memberAdopt:
    "adopts the member as it is on disk now and discards the old proposals and staged fields",
  memberOpen: "adopts the member's saved bytes as the Work basis; refuses while edits are pending",
  scheduleRead: "reads the selected schedule from Revit into a fresh capture",
} as const;

/** Ops targets the selected operation; its human press is not another host workflow. */
export const opsAction = (
  needs: "nothing" | "document" | "project-document" | "family-document" = "nothing",
  hostLocal = false,
) => ({
  says: "runs the selected operation on the target the sentence names",
  actor: "human" as const,
  needs: hostLocal
    ? ("host" as const)
    : (
        {
          nothing: "session",
          document: "document",
          "project-document": "project",
          "family-document": "family",
        } as const
      )[needs],
});
