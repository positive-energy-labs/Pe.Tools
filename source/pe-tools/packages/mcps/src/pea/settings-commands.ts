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

/** Execution uses the same validated composition as the settings reader; raw JSON stays authored. */
export function executionContent(snapshot: SettingsDocumentSnapshot): string {
  if (!snapshot.validation.isValid)
    throw new Error(
      snapshot.validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"),
    );
  if (snapshot.composedContent == null)
    throw new Error(
      "No composed settings content was returned. Open with includeComposedContent=true.",
    );
  return snapshot.composedContent;
}

/** Build the settings command handlers, bound to a resolved host base URL. */
export function createSettingsCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<SettingsRouteDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = new HostRpcCaller({ hostBaseUrl });

  return {
    create: async (input, ctx) => {
      const { documentId, rawContent } = input as {
        documentId: SettingsDocumentId;
        rawContent: string;
      };
      const result = await caller.call("settings.document.save", {
        documentId,
        rawContent,
        createOnly: true,
      });
      if (result.conflictDetected)
        throw new Error(
          `Create conflict: ${result.conflictMessage ?? "the settings document already exists"}. Open the existing document or choose a new relative path.`,
        );
      if (!result.writeApplied) throw new Error("The settings document was not created.");

      const snapshot = await openSnapshot(caller, documentId);
      const document = ctx.getDoc();
      document.bindings.file = { id: snapshot.path, label: snapshot.path };
      document.documentId = documentId;
      document.fields = {};
      document.savedAt = new Date().toISOString();
      await ctx.setDoc(document);
      return summarizeSnapshot(snapshot);
    },

    open: async (input, ctx) => {
      const { documentId } = input as { documentId: SettingsDocumentId };
      const snapshot = await openSnapshot(caller, documentId);
      const document = ctx.getDoc();
      document.bindings.file = { id: snapshot.path, label: snapshot.path };
      document.documentId = documentId;
      await ctx.setDoc(document);
      return summarizeSnapshot(snapshot);
    },

    refresh: async (_input, ctx) => {
      const document = ctx.getDoc();
      const documentId = document.documentId;
      if (!documentId) {
        throw new Error(
          "No settings document is open. Run the `open` command with a documentId (module/root/relative path) first.",
        );
      }
      const snapshot = await openSnapshot(caller, documentId);
      return summarizeSnapshot(snapshot);
    },

    validate: async (input, ctx) => {
      const { includeProposals } = input as { includeProposals?: boolean };
      const document = ctx.getDoc();
      const documentId = document.documentId;
      if (!documentId) {
        throw new Error("No settings document is open. Run the `open` command first.");
      }
      const snapshot = await openSnapshot(caller, documentId);

      const parsed = parseRawContent(snapshot.rawContent);
      spliceFields(parsed, document, { includeProposals: includeProposals ?? false });
      const rawContent = JSON.stringify(parsed, null, 2);

      let validation;
      try {
        validation = await caller.call("settings.document.validate", {
          documentId,
          rawContent,
        });
      } catch (error) {
        throw new Error(`settings.document.validate failed (${message(error)}).`);
      }

      return validation;
    },

    save: async (_input, ctx) => {
      const document = ctx.getDoc();
      const documentId = document.documentId;
      if (!documentId) {
        throw new Error("No settings document is open. Run the `open` command first.");
      }
      const snapshot = await openSnapshot(caller, documentId);

      const stagedPaths = stagedEntries(document.fields);
      if (stagedPaths.length === 0)
        return { writeApplied: false, saved: 0, reason: "nothing staged" };

      const parsed = parseRawContent(snapshot.rawContent);
      for (const [path, field] of stagedPaths) {
        applyFieldEdit(parsed, settingsFieldSegments(path), field.staged!);
      }
      const rawContent = JSON.stringify(parsed, null, 2);

      let result;
      try {
        result = await caller.call("settings.document.save", {
          documentId,
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
        throw new Error(
          `Save not applied: ${result.validation.isValid ? "the host rejected the write" : `${result.validation.issues.length} validation issue(s)`}. Fix and save again.`,
        );
      }

      const latest = ctx.getDoc();
      for (const [path] of stagedPaths) {
        latest.fields[path] = {};
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
      documentId,
      includeComposedContent: true,
    });
  } catch (error) {
    throw new Error(
      `settings.document.open failed (${message(error)}). Check the module/root/relative path against settings.workspaces and settings.tree.`,
    );
  }
  const absolutePath = raw.metadata.documentId.stableId;
  if (!absolutePath) throw new Error("settings.document.open returned no absolute document path.");
  const versionToken = raw.metadata.versionToken?.value;
  return {
    documentId,
    path: absolutePath,
    versionToken: versionToken ?? null,
    observedAt: new Date().toISOString(),
    rawContent: raw.rawContent,
    composedContent: raw.composedContent ?? null,
    modifiedUtc: raw.metadata.modifiedUtc ?? null,
    validation: toRouteValidation(raw.validation),
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
      applyFieldEdit(root, segments, field.proposal);
    }
    if (field.staged != null) applyFieldEdit(root, segments, field.staged);
  }
}

/** Apply one explicit set/delete edit at a field pointer's segments. */
function applyFieldEdit(
  root: Record<string, unknown>,
  segments: string[],
  edit: { value?: unknown; delete?: true },
) {
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
  const leaf = segments[segments.length - 1];
  if (edit.delete === true) delete cursor[leaf];
  else cursor[leaf] = edit.value;
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
