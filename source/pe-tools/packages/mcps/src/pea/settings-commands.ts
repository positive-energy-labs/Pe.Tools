/**
 * /settings command handlers — open/refresh/validate/save over the host settings.* ops.
 * See route-state-commands.ts for the handler idiom (getDoc/setDoc, hint-rich errors).
 *
 * These are the side-effectful work the agent write mask forbids doing by hand: open a
 * schema-backed settings document, re-read it, validate a candidate splice, and save
 * (human-only). They run where the pea runtime is composed (in-process with the host),
 * reaching the TS host through `HostRpcCaller` — no Revit session required.
 */
import {
  type SettingsDocumentId,
  type SettingsRouteDocument,
  type SettingsSnapshot,
  settingsFieldSegments,
  stagedEntries,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers } from "@pe/agent-contracts";
import type {
  SettingsDocumentSnapshot,
  SettingsValidationResult,
} from "@pe/host-contracts/operation-types";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export { settingsRouteState } from "@pe/agent-contracts";

/** Build the settings command handlers, bound to a resolved host base URL. */
export function createSettingsCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<SettingsRouteDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = () => new HostRpcCaller({ hostBaseUrl });

  return {
    open: async (input, ctx) => {
      const { documentId } = input as { documentId: SettingsDocumentId };
      const snapshot = await openSnapshot(caller(), documentId);
      const document = ctx.getDoc();
      document.snapshot = snapshot; // Preserve existing fields (proposals/staged).
      await ctx.setDoc(document);
      return summarizeSnapshot(snapshot);
    },

    refresh: async (_input, ctx) => {
      const document = ctx.getDoc();
      const documentId = document.snapshot?.documentId;
      if (!documentId) {
        throw new Error(
          "No settings document is open. Run the `open` command with a documentId (module/root/relative path) first.",
        );
      }
      const snapshot = await openSnapshot(caller(), documentId);
      const latest = ctx.getDoc();
      latest.snapshot = snapshot;
      await ctx.setDoc(latest);
      return summarizeSnapshot(snapshot);
    },

    validate: async (input, ctx) => {
      const { includeProposals } = input as { includeProposals?: boolean };
      const document = ctx.getDoc();
      const snapshot = document.snapshot;
      if (!snapshot) {
        throw new Error("No settings document is open. Run the `open` command first.");
      }

      const parsed = parseRawContent(snapshot.rawContent);
      spliceFields(parsed, document, { includeProposals: includeProposals ?? false });
      const rawContent = JSON.stringify(parsed, null, 2);

      let validation;
      try {
        validation = await caller().call("settings.document.validate", {
          documentId: toHostDocumentId(snapshot.documentId),
          rawContent,
        });
      } catch (error) {
        throw new Error(`settings.document.validate failed (${message(error)}).`);
      }

      const latest = ctx.getDoc();
      if (latest.snapshot) latest.snapshot.validation = toRouteValidation(validation);
      await ctx.setDoc(latest);
      return validation;
    },

    save: async (_input, ctx) => {
      const document = ctx.getDoc();
      const snapshot = document.snapshot;
      if (!snapshot) {
        throw new Error("No settings document is open. Run the `open` command first.");
      }

      const stagedPaths = stagedEntries(document.fields);
      if (stagedPaths.length === 0)
        return { writeApplied: false, saved: 0, reason: "nothing staged" };
      const attention = stagedPaths.filter(([, field]) => field.review === "attention");
      if (attention.length > 0) {
        throw new Error(
          `Save blocked: ${attention.length} staged field${attention.length === 1 ? "" : "s"} need review (review is "attention").`,
        );
      }

      const parsed = parseRawContent(snapshot.rawContent);
      for (const [path, field] of stagedPaths) {
        spliceValue(parsed, settingsFieldSegments(path), field.staged?.value);
      }
      const rawContent = JSON.stringify(parsed, null, 2);

      let result;
      try {
        result = await caller().call("settings.document.save", {
          documentId: toHostDocumentId(snapshot.documentId),
          rawContent,
          expectedVersionToken:
            snapshot.versionToken != null ? { value: snapshot.versionToken } : undefined,
        });
      } catch (error) {
        throw new Error(`settings.document.save failed (${message(error)}).`);
      }

      if (result.conflictDetected) {
        throw new Error(
          `Save conflict: ${result.conflictMessage ?? "a newer version exists on the host"}. Run the \`refresh\` command to pull the latest content, re-stage, then save again.`,
        );
      }
      if (!result.writeApplied) {
        // Validation failed host-side: fold the fresh validation in and leave staged fields.
        const latest = ctx.getDoc();
        if (latest.snapshot) latest.snapshot.validation = toRouteValidation(result.validation);
        await ctx.setDoc(latest);
        throw new Error(
          `Save not applied: ${result.validation.isValid ? "the host rejected the write" : `${result.validation.issues.length} validation issue(s)`}. Fix and save again.`,
        );
      }

      // Success: fold metadata/validation, adopt the saved raw content, and clear the
      // fields we just wrote (failed/partial saves aren't possible here — it's one write).
      const latest = ctx.getDoc();
      if (latest.snapshot) {
        latest.snapshot.rawContent = rawContent;
        latest.snapshot.versionToken = result.metadata.versionToken?.value ?? null;
        latest.snapshot.modifiedUtc = result.metadata.modifiedUtc ?? null;
        latest.snapshot.validation = toRouteValidation(result.validation);
        latest.snapshot.takenAt = new Date().toISOString();
      }
      for (const [path] of stagedPaths) {
        latest.fields[path] = { review: "none" };
      }
      latest.savedAt = new Date().toISOString();
      await ctx.setDoc(latest);

      return { writeApplied: true, saved: stagedPaths.length };
    },
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function openSnapshot(
  caller: HostRpcCaller,
  documentId: SettingsDocumentId,
): Promise<SettingsSnapshot> {
  let raw: SettingsDocumentSnapshot;
  try {
    raw = await caller.call("settings.document.open", {
      documentId: toHostDocumentId(documentId),
      includeComposedContent: true,
    });
  } catch (error) {
    throw new Error(
      `settings.document.open failed (${message(error)}). Check the module/root/relative path against settings.workspaces and settings.tree.`,
    );
  }
  return {
    documentId,
    rawContent: raw.rawContent,
    composedContent: raw.composedContent ?? null,
    versionToken: raw.metadata.versionToken?.value ?? null,
    modifiedUtc: raw.metadata.modifiedUtc ?? null,
    validation: toRouteValidation(raw.validation),
    takenAt: new Date().toISOString(),
  };
}

/** The route-doc documentId carries only the three addressing keys; the host op accepts them. */
function toHostDocumentId(documentId: SettingsDocumentId) {
  return {
    moduleKey: documentId.moduleKey,
    rootKey: documentId.rootKey,
    relativePath: documentId.relativePath,
  };
}

function parseRawContent(rawContent: string): Record<string, unknown> {
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(`The open document's raw content is not valid JSON (${message(error)}).`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The open document's raw content is not a JSON object; cannot splice fields.");
  }
  return parsed as Record<string, unknown>;
}

/** Splice a field's staged (and optionally proposal) values into the parsed document. */
function spliceFields(
  root: Record<string, unknown>,
  document: SettingsRouteDocument,
  options: { includeProposals: boolean },
) {
  for (const [path, field] of Object.entries(document.fields)) {
    const segments = settingsFieldSegments(path);
    if (segments.length === 0) continue;
    // Proposal first, staged wins — staged is the human-promoted value.
    if (options.includeProposals && field.proposal != null) {
      spliceValue(root, segments, field.proposal.value);
    }
    if (field.staged != null) spliceValue(root, segments, field.staged.value);
  }
}

/** Set `value` at a dot-path's segments, creating intermediate objects as needed. */
function spliceValue(root: Record<string, unknown>, segments: string[], value: unknown) {
  if (segments.length === 0) return;
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    const next = cursor[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** Host validation is a readonly Effect struct; the route document wants a plain mutable copy. */
function toRouteValidation(validation: SettingsValidationResult): SettingsSnapshot["validation"] {
  return {
    isValid: validation.isValid,
    issues: validation.issues.map((issue) => ({ ...issue })),
  };
}

function summarizeSnapshot(snapshot: SettingsSnapshot) {
  return {
    documentId: snapshot.documentId,
    versionToken: snapshot.versionToken,
    isValid: snapshot.validation?.isValid ?? null,
    issueCount: snapshot.validation?.issues.length ?? 0,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
