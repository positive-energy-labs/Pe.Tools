import { z } from "zod";
import { nativeProcessSchema } from "./action-receipts.ts";
import {
  sdkSessionSelectionSchema,
  sdkDocumentRefSchema,
  type SdkSessionSelection,
} from "./sdk-session.ts";

/**
 * A new Revit. `owner: "pea"` is a background posture (no window brought forward); `addins: "off"`
 * quarantines third-party add-ins for that Revit.
 */
export const instancesStartSchema = z.strictObject({
  year: z.string().regex(/^20\d{2}$/),
  owner: z.enum(["you", "pea"]),
  addins: z.enum(["on", "off"]),
});
export type InstancesStart = z.infer<typeof instancesStartSchema>;

/**
 * One launch: a source opened into a running session or into a new Revit. Every option is the
 * SDK's own `doc open` flag; the press that named it is the consent (ADR 0016), so nothing is
 * staged and nothing waits for a second approval. Whether a launch is Pea's is derived from the
 * target session's posture, never passed.
 */
export const instancesLaunchSchema = z.strictObject({
  /** A local path, a `cld://` identity, `recent:<title>`, or an openId (with `reload`). */
  source: z.string().trim().min(1),
  /** `source` is a .rte or .rft template path: a new unsaved document is created from it. */
  template: z.boolean().optional(),
  into: z.union([
    z.strictObject({ session: sdkSessionSelectionSchema }),
    z.strictObject({ start: instancesStartSchema }),
  ]),
  /** Open detached from central, preserving worksets. Pea's copies of workshared models set it. */
  detach: z.boolean().optional(),
  /** Open a file saved by an older Revit in this newer one; nothing is saved. */
  upgrade: z.boolean().optional(),
  /** A missing linked file: allow (open without it, reported) or refuse the open. Default refuse. */
  links: z.enum(["allow", "refuse"]).optional(),
  /** `source` is an open document's openId: reload the latest central changes into it. */
  reload: z.boolean().optional(),
});
export type InstancesLaunch = z.infer<typeof instancesLaunchSchema>;

export const instancesSessionSchema = z.strictObject({
  selection: sdkSessionSelectionSchema,
  process: nativeProcessSchema,
});
const sessionInput = z.object({ session: instancesSessionSchema });
/** Explicit unsaved-work policy for stop and close. Development HR restart always discards. */
export const instancesUnsavedSchema = z.enum(["keep", "discard"]);
const unsaved = instancesUnsavedSchema;

export const instancesActions = {
  "instances.start": {
    says: "Start an empty Revit of one installed year. owner pea starts it in the background; addins off quarantines third-party add-ins. The receipt is the SDK envelope.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: instancesStartSchema,
  },
  "instances.open": {
    says: "Open a source into a running session (into.session) or into a new Revit (into.start). A local, non-workshared file opened for Pea is copied into Pea's work folder first and the copy opens; a workshared or cloud model opens detached. The receipt names the opened path.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: instancesLaunchSchema,
  },
  "instances.restart": {
    says: "Restart the explicitly supplied development session, discarding unsaved changes and reopening its documents.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: sessionInput.strict(),
  },
  "instances.stop": {
    says: "Stop the explicitly supplied session incarnation, keeping or discarding unsaved changes as the caller chose.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: sessionInput.extend({ force: z.boolean().default(false), unsaved }),
  },
  "instances.close": {
    says: "Close the explicitly supplied document lifetime by its published openId, keeping or discarding unsaved changes as the caller chose.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: sessionInput.extend({ document: sdkDocumentRefSchema, unsaved }),
  },
} as const;
export type InstancesActionKey = keyof typeof instancesActions;

/**
 * The SDK session an Instances action input addresses: an incarnation's `session.selection`, or a
 * launch's `into.session`. Null for an action that starts a new Revit.
 */
export function instancesSessionSelection(input: unknown): SdkSessionSelection | null {
  const record = (value: unknown) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  const selected =
    record(record(input)?.session)?.selection ?? record(record(input)?.into)?.session;
  return selected === undefined ? null : sdkSessionSelectionSchema.parse(selected);
}

export const instancesReading = {
  says: "Read SDK sessions, installed years, recents or open documents.",
  dirties: [],
  needs: "nothing",
  actor: "any",
  mutates: false,
  input: z.object({
    read: z.enum(["sessions", "doctor", "recents", "documents"]),
    session: sdkSessionSelectionSchema.optional(),
    year: z.string().optional(),
    all: z.boolean().optional(),
  }),
} as const;
