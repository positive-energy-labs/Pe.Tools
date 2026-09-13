import {
  type SettingsDocumentId,
  type SettingsRouteDocument,
  settingsBasisSchema,
  settingsCandidate,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers } from "@pe/agent-contracts";
import type {
  SettingsDocumentSnapshot,
  OpenSettingsDocumentRequest,
  ValidateSettingsDocumentRequest,
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

/** Work commands share the host conditional writer; root owns admission and receipts. */
export function createSettingsCommandHandlers(
  options: {
    hostBaseUrl?: string;
    settings?: {
      openSettings(
        this: void,
        request: OpenSettingsDocumentRequest,
      ): Promise<SettingsDocumentSnapshot>;
      validateSettings(
        this: void,
        request: ValidateSettingsDocumentRequest,
      ): Promise<SettingsValidationResult>;
    };
  } = {},
): RouteStateCommandHandlers<SettingsRouteDocument> {
  const caller = () => new HostRpcCaller({ hostBaseUrl: resolveHostBaseUrl(options.hostBaseUrl) });
  const open = async (documentId: SettingsDocumentId, workspaceId: string) =>
    (
      options.settings?.openSettings ??
      ((request: OpenSettingsDocumentRequest) => caller().call("settings.document.open", request))
    )({
      documentId,
      workspaceId,
      mode: "file",
      includeComposedContent: true,
    });
  const basis = (snapshot: SettingsDocumentSnapshot) =>
    settingsBasisSchema.parse({
      documentId: snapshot.metadata.documentId,
      path: snapshot.metadata.documentId.stableId,
      rawContent: snapshot.rawContent,
      versionToken: snapshot.metadata.versionToken?.value,
    });
  const workspace = (ctx: { work?: string }) => {
    if (!ctx.work) throw new Error("Settings work requires the host-resolved file Work key.");
    return ctx.work;
  };
  const requireBasis = (document: SettingsRouteDocument) => {
    if (!document.basis) throw new Error("Open a settings file and adopt its basis first.");
    return document.basis;
  };
  const pending = (document: SettingsRouteDocument) =>
    Object.values(document.fields).some((field) => field.staged || field.proposal);
  return {
    open: async (input, ctx) => {
      const { documentId } = input as { documentId: SettingsDocumentId };
      const document = ctx.getDoc();
      const snapshot = await open(documentId, workspace(ctx));
      const next = basis(snapshot);
      if (document.basis?.path === next.path && document.basis.versionToken === next.versionToken)
        return snapshot;
      if (pending(document))
        throw new Error(
          "Pending work retains its original basis. Review the new reading and explicitly adopt it, discarding old edits.",
        );
      await ctx.setDoc({ basis: next, fields: {} });
      return snapshot;
    },
    adopt: async (input, ctx) => {
      const { documentId, versionToken } = input as {
        documentId: SettingsDocumentId;
        versionToken: string;
      };
      const snapshot = await open(documentId, workspace(ctx));
      const next = basis(snapshot);
      if (next.versionToken !== versionToken)
        throw new Error("The file changed after review. Refresh and review again.");
      await ctx.setDoc({ basis: next, fields: {} });
      return snapshot;
    },
    refresh: async (_input, ctx) => open(requireBasis(ctx.getDoc()).documentId, workspace(ctx)),
    validate: async (input, ctx) => {
      const document = ctx.getDoc();
      const original = requireBasis(document);
      return (
        options.settings?.validateSettings ??
        ((request: ValidateSettingsDocumentRequest) =>
          caller().call("settings.document.validate", request))
      )({
        documentId: original.documentId,
        mode: "file",
        rawContent: settingsCandidate(
          original.rawContent,
          document.fields,
          Boolean((input as { includeProposals?: boolean }).includeProposals),
        ),
      });
    },
  };
}
