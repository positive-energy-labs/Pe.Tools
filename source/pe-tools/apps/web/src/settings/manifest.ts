/**
 * The settings route, declared once. It replaces `settings/store.ts` (the Work spec and the
 * commands are now the manifest's `work` and `actions`) and `settings/product.ts` (the slot/verb
 * table is now the action list). Nothing here renders and nothing here holds React state.
 *
 * Settings is file-driven: its Readings are the bound document and the schema that renders it,
 * both `{kind:"file"}`. The route's Work is `settingsRouteState`, whose four commands
 * (open/adopt/refresh/validate) are reached through the one route-state writer; `save` is the
 * external mutation and goes through the action client so it earns a receipt.
 */
import { z } from "zod";
import {
  settingsDocumentIdSchema,
  settingsRouteState,
  type SettingsDocumentId,
  type SettingsRouteDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import { defineRoute, semanticActionFacts, type RouteHandle, type RouteManifest } from "#/route";
import {
  SETTINGS_SEEDS,
  SETTINGS_SEED_DOCUMENT_ID,
  SETTINGS_SEED_SCHEMA_ID,
  type SettingsAction,
  type SettingsPage,
  type SettingsReading,
} from "#/settings/seeds";
import {
  saveSettingsAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

export type { SettingsAction, SettingsPage, SettingsReading };

export type SettingsRouteManifest = RouteManifest<
  SettingsRouteDocument,
  SettingsReading,
  SettingsPage,
  SettingsAction
>;

export type SettingsHandle = RouteHandle<
  SettingsRouteDocument,
  SettingsReading,
  SettingsPage,
  SettingsAction
>;

export interface SettingsRouteDeps {
  /** The Work this route reads and writes. */
  scope: WorkKey;
  /** The document the Readings are OF. Absent = the seed address, so the demo lane still reads. */
  documentId?: SettingsDocumentId;
  /** Picking a file is navigation, not a write: the shell hands the route its navigator. */
  selectFile?: (documentId: SettingsDocumentId) => Promise<void>;
}

const page = z.object({
  workspaceKey: z.string().optional(),
  moduleKey: z.string().optional(),
  rootKey: z.string().optional(),
  filePath: z.string().optional(),
  query: z.string().optional(),
  field: z.string().optional(),
});

const stageInput = z.object({ path: z.string(), value: z.unknown() });
const openInput = z.object({ documentId: settingsDocumentIdSchema }).partial();
const adoptInput = z.object({ versionToken: z.string() });
const validateInput = z.object({ includeProposals: z.boolean().optional() }).partial();

export const settingsManifest = (deps: SettingsRouteDeps): SettingsRouteManifest => {
  const documentId = deps.documentId ?? SETTINGS_SEED_DOCUMENT_ID;
  const schemaId = deps.documentId
    ? { ...deps.documentId, relativePath: SETTINGS_SEED_SCHEMA_ID.relativePath }
    : SETTINGS_SEED_SCHEMA_ID;

  return defineRoute({
    key: "settings",
    name: "Settings",
    docs: "Open a settings file as the edit basis, make the needed changes, then save the reviewed document back to disk.",
    // File-driven: a settings document is read from disk, never from an open Revit model.
    work: settingsRouteState,
    readings: {
      document: { kind: "file", id: documentId },
      schema: { kind: "file", id: schemaId },
    },
    page,
    actions: {
      open: {
        label: "open",
        says: "adopts the picked file as the edit basis; refuses while edits are pending",
        needs: "host",
        actor: "any",
        input: openInput as unknown as z.ZodType<never>,
        dirties: ["document", "schema"],
        ready: (ctx) =>
          ctx.page?.filePath || ctx.work?.doc?.basis || deps.documentId
            ? null
            : "pick a settings file first",
        run: async (ctx, input) => {
          const picked = (input as { documentId?: SettingsDocumentId } | undefined)?.documentId;
          const next =
            picked ??
            (ctx.page?.moduleKey && ctx.page.rootKey && ctx.page.filePath
              ? {
                  moduleKey: ctx.page.moduleKey,
                  rootKey: ctx.page.rootKey,
                  relativePath: ctx.page.filePath,
                }
              : documentId);
          if (deps.selectFile) return deps.selectFile(next);
          return ctx.command("open", { documentId: next });
        },
      },
      refresh: {
        label: "re-read",
        says: "re-reads the bound settings document; proposals and staged values are preserved",
        needs: "host",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["document"],
        ready: (ctx) => (ctx.work?.doc?.basis ? null : "open a settings file first"),
        run: (ctx) => ctx.command("refresh"),
      },
      validate: {
        label: "validate",
        says: "validates the candidate — staged values spliced in — without saving",
        needs: "host",
        actor: "any",
        input: validateInput as unknown as z.ZodType<never>,
        dirties: ["document"],
        ready: (ctx) => (ctx.work?.doc?.basis ? null : "open a settings file first"),
        run: (ctx, input) =>
          ctx.command("validate", {
            includeProposals: false,
            ...((input ?? {}) as { includeProposals?: boolean }),
          }),
      },
      adopt: {
        label: "adopt",
        says: "adopts the reviewed disk version and discards the old proposals and staged edits",
        needs: "host",
        actor: "human",
        input: adoptInput as unknown as z.ZodType<never>,
        dirties: ["document"],
        ready: (ctx) => (ctx.work?.doc?.basis ? null : "open a settings file first"),
        run: (ctx, input) =>
          ctx.command("adopt", {
            documentId: ctx.work?.doc?.basis?.documentId ?? documentId,
            versionToken: (input as { versionToken?: string } | undefined)?.versionToken ?? "",
          }),
      },
      save: {
        label: "save",
        ...semanticActionFacts("settings.write"),
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["document"],
        requires: { work: true },
        ready: (ctx) => {
          const doc = ctx.work?.doc;
          if (!doc?.basis) return "open a settings file first";
          if (!doc.basis.versionToken) return "review an adopted file before saving";
          return null;
        },
        run: async (ctx) => {
          const doc = ctx.work?.doc;
          const revision = ctx.work.revision;
          if (!doc || revision === null) throw new Error("Settings Work unavailable");
          const row = await saveSettingsAction(deps.scope, doc, revision);
          const result = actionResult(row) as { kind?: string } | undefined;
          if (result?.kind === "conflict")
            throw new Error(
              "File conflict. Refresh, review, and explicitly adopt the new basis; edits were preserved.",
            );
        },
      },
      stage: {
        label: "stage",
        says: "stages one field value on the candidate; the saved file is untouched until save",
        needs: "host",
        actor: "human",
        input: stageInput as unknown as z.ZodType<never>,
        dirties: ["document"],
        // Staging is per-field: without a pointer there is nothing to stage, and the page names
        // the field the surface has selected. `run` used to throw on the missing pointer AFTER
        // the button said it was runnable.
        ready: (ctx, input) =>
          !ctx.work?.doc?.basis
            ? "open a settings file first"
            : ((input as { path?: string } | undefined)?.path ?? ctx.page?.field)
              ? null
              : "select a field to stage",
        run: async (ctx, input) => {
          const { path, value } = (input ?? {}) as { path?: string; value?: unknown };
          const field = path ?? ctx.page?.field;
          if (field === undefined) throw new Error("stage needs a field pointer");
          await ctx.write([{ path: ["fields", field, "staged"], value: { value } }]);
        },
      },
    },
    seeds: SETTINGS_SEEDS as never,
  });
};
