import { z } from "zod";
import { nativeProcessSchema } from "./action-receipts.ts";
import { sdkReadingSchema } from "./reading.ts";
import {
  sdkSessionSelectionSchema,
  sdkDocumentRefSchema,
  type SdkSessionSelection,
} from "./sdk-session.ts";

/**
 * A new Revit. `owner: "pea"` starts it in the background (no window brought forward) as an
 * acquisition: Pea may stop it while every document in it is its own. `addins: "off"` quarantines
 * third-party add-ins for that Revit.
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
 * staged and nothing waits for a second approval. Whether a launch is an acquisition is derived
 * from `into.start.owner` or the target Revit's acquisition receipts, never passed.
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

const sessionInput = z.strictObject({
  session: z.strictObject({ selection: sdkSessionSelectionSchema, process: nativeProcessSchema }),
});
/** Unsaved work has no default: the caller keeps or discards it, every time. */
const unsaved = z.enum(["keep", "discard"]);
/** Workshared ownership on the way out: all returns every borrow to central, none keeps them. */
const release = z.enum(["none", "all"]);
/** Where a save writes: in place, a new copy (never over a file), or a synchronize with central. */
const saveTo = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("self") }),
  z.strictObject({
    kind: z.literal("copy"),
    out: z.string().trim().min(1),
    /** From a workshared model: preserve keeps a detached central, strip an independent copy. */
    worksets: z.enum(["preserve", "strip"]).optional(),
  }),
  z.strictObject({ kind: z.literal("central"), comment: z.string().max(30_000).optional() }),
]);

/**
 * `needs` is the effect: `document` touches one exact lifetime, `session` every document the
 * session holds. The host resolves the affected lifetimes and admits each through one crossing.
 */
export const instancesActions = {
  "instances.start": {
    says: "Start an empty Revit of one installed year. owner pea starts it in the background; addins off quarantines third-party add-ins. The receipt is the SDK envelope.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: instancesStartSchema,
  },
  "instances.open": {
    says: "Open a source into a running session (into.session) or into a new Revit (into.start). Into a new Revit with owner pea, or into a Revit Pea's acquisition started, the open is an acquisition: a local file is copied into Pea's work folder first and the copy opens (detached when workshared); a cloud model opens detached. Pea writes the document only once its native facts certify it independent. The receipt names the acquisition id and the opened path.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: instancesLaunchSchema,
  },
  "instances.restart": {
    says: "Restart the explicitly supplied session incarnation, discarding unsaved changes and reopening its documents.",
    dirties: ["sdk"],
    needs: "session",
    actor: "any",
    input: sessionInput,
  },
  "instances.stop": {
    says: "Stop the explicitly supplied session incarnation, keeping or discarding unsaved changes as the caller chose.",
    dirties: ["sdk"],
    needs: "session",
    actor: "any",
    input: sessionInput.extend({ force: z.boolean().default(false), unsaved }),
  },
  "instances.reset": {
    says: "Recover a stuck session incarnation: dismiss its windows, cancel its operations, close its documents keeping or discarding unsaved work, and restart it if still blocked (or always, with restart).",
    dirties: ["sdk"],
    needs: "session",
    actor: "any",
    input: sessionInput.extend({
      unsaved,
      release: release.optional(),
      restart: z.boolean().default(false),
    }),
  },
  "instances.dialogs": {
    says: "Dismiss one window of the session incarnation by the handle a dialogs reading just listed.",
    dirties: ["sdk"],
    needs: "session",
    actor: "any",
    input: sessionInput.extend({ hwnd: z.string().trim().min(1) }),
  },
  "instances.save": {
    says: "Save the explicitly supplied document lifetime in place, as a new copy, or by synchronizing with central, optionally returning its workshared ownership.",
    dirties: ["sdk"],
    needs: "document",
    actor: "any",
    input: sessionInput.extend({
      document: sdkDocumentRefSchema,
      to: saveTo,
      release: release.optional(),
    }),
  },
  "instances.handover": {
    says: "Hand over one acquisition by its id: save its document to the acquisition's reserved result path (create-only, never central, ownership kept), then write a diff plan against its recorded baseline that names what it could not compare. Review only: nothing merges, loads back, overwrites or syncs.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: z.strictObject({ acquisition: z.string().min(1) }),
  },
  "instances.cleanup": {
    says: "Release one acquisition by its id: close its document (keep refuses while it holds changes no handover saved; discard drops them), stop the Revit it started once nothing else is open there, and remove its temporary copies. A handover's result, diff plan and baseline are kept.",
    dirties: ["sdk"],
    needs: "nothing",
    actor: "any",
    input: z.strictObject({ acquisition: z.string().min(1), unsaved }),
  },
  "instances.close": {
    says: "Close the explicitly supplied document lifetime by its published openId, keeping or discarding unsaved changes as the caller chose.",
    dirties: ["sdk"],
    needs: "document",
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
  says: "Read SDK sessions, installed years, recents, open documents, or one session's visible windows (dialogs).",
  dirties: [],
  needs: "nothing",
  actor: "any",
  mutates: false,
  input: sdkReadingSchema.omit({ kind: true }),
} as const;
