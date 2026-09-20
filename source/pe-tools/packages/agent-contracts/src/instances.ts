import { z } from "zod";
import { nativeProcessSchema } from "./action-receipts.ts";
import { documentRefSchema } from "./target.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { trichotomyCellSchema } from "./trichotomy.ts";
const SDK_SESSION_SELECTOR_PREFIX = "session:";
export const sdkSessionSelectorSchema = z.templateLiteral([
  SDK_SESSION_SELECTOR_PREFIX,
  z.string().min(1),
]);
export type SdkSessionSelector = z.infer<typeof sdkSessionSelectorSchema>;
export const sdkSessionSelectorOf = (target: string): SdkSessionSelector =>
  sdkSessionSelectorSchema.parse(`${SDK_SESSION_SELECTOR_PREFIX}${target}`);
export const sdkSessionTargetOf = (selector: SdkSessionSelector): string =>
  selector.slice(SDK_SESSION_SELECTOR_PREFIX.length);

const documentSelector = z.string().trim().min(1);
/** What open/start launches: a document into a session, or a new session. */
export const instancesLaunchSchema = z.discriminatedUnion("kind", [
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
]);
export type InstancesLaunch = z.infer<typeof instancesLaunchSchema>;
/**
 * One authored cell: Pea may propose a launch, a person stages it, and open/start read `staged`
 * only. Strict, so Work in the old `{ staged }` shape fails closed rather than lose its value.
 */
export const instancesDocumentSchema = z.strictObject({
  launch: trichotomyCellSchema(instancesLaunchSchema).default({}),
});
export type InstancesDocument = z.infer<typeof instancesDocumentSchema>;
export const instancesRouteState = {
  route: "instances",
  title: "Instances",
  description:
    "Select Revit sessions and stage documents. Refresh to discover installed years, sessions and recents. Pea may propose a launch (an open or a start); a person stages it, and open/start launch exactly the staged value, never a proposal. Other lifecycle commands are human-only.",
  schema: instancesDocumentSchema,
  // Pea proposes; the staged launch is a person's, and it is what open/start consume.
  agentWriteMask: [["launch", "proposal"]],
  commands: {},
} satisfies RouteStateSpec<typeof instancesDocumentSchema>;

export const instancesSessionSchema = z.strictObject({
  id: z.string().min(1),
  process: nativeProcessSchema,
});
const workInput = z.object({ workspaceId: z.string().min(1) });
const sessionInput = workInput.extend({ session: instancesSessionSchema });
export const instancesActions = {
  "instances.start": {
    says: "Start the authored staged session through the SDK under this action id; the receipt is the SDK envelope.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: workInput,
    description:
      "Start the authored staged session through the SDK under this action id; the receipt is the SDK envelope.",
  },
  "instances.open": {
    says: "Open the authored staged document in the explicitly supplied session incarnation; refused if that document is already open there.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: sessionInput,
    description:
      "Open the authored staged document in the explicitly supplied session incarnation; refused if that document is already open there.",
  },
  "instances.restart": {
    says: "Restart the explicitly supplied session incarnation. Human-only.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "human",
    input: sessionInput,
    description: "Restart the explicitly supplied session incarnation. Human-only.",
  },
  "instances.stop": {
    says: "Stop the explicitly supplied session incarnation. Human-only.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "human",
    input: sessionInput.extend({ force: z.boolean().default(false) }),
    description: "Stop the explicitly supplied session incarnation. Human-only.",
  },
  "instances.close": {
    says: "Close the explicitly supplied document lifetime by its published openId. Human-only.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "human",
    input: sessionInput.extend({ document: documentRefSchema, intent: z.string().min(1) }),
    description:
      "Close the explicitly supplied document lifetime by its published openId. Human-only.",
  },
} as const;
export type InstancesActionKey = keyof typeof instancesActions;

export const instancesReading = {
  says: "Read SDK sessions, installed years, recents or current documents without changing authored Instances Work.",
  dirties: [],
  needs: "nothing",
  actor: "any",
  mutates: false,
  description:
    "Read SDK sessions, installed years, recents or current documents without changing authored Instances Work.",
  input: z.object({
    read: z.enum(["sessions", "doctor", "recents", "current"]),
    id: z.string().optional(),
    year: z.string().optional(),
    all: z.boolean().optional(),
  }),
} as const;
