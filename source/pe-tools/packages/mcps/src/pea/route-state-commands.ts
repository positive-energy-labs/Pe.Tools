/**
 * /family-types command handlers — the server-side implementations the route-state
 * dispatcher runs for `parse_spec`, `refresh_snapshot`, and `push`.
 *
 * These are the side-effectful work the agent write mask forbids doing by hand: OCR a
 * spec PDF, re-read the family editor, and push staged cells to Revit. They run where
 * the pea runtime is composed (in-process with the host), reaching Revit through
 * `HostRpcCaller` and the web parse endpoint through `PE_WEB_URL`.
 */
import {
  type FamilyTypesDocument,
  type FamilyTypesSnapshot,
  type ParameterLinksData,
  type ParameterLinksDocument,
  type ParameterLinkProfile,
  familyTypesSnapshotSchema,
  isFormulaCellKey,
  parameterLinksDataSchema,
  splitCellKey,
} from "@pe/agent-contracts";
import type {
  RevitApplyParameterLinks,
  RevitDetailParameterLinks,
} from "@pe/host-contracts/generated";
import type { RouteStateCommandHandlers } from "@pe/runtime";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export { familyTypesRouteState, parameterLinksRouteState } from "@pe/agent-contracts";

/** Build the three family-types command handlers, bound to a resolved host base URL. */
export function createFamilyTypesCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = () => new HostRpcCaller({ hostBaseUrl });

  return {
    parse_spec: async (input, ctx) => {
      const { url } = input as { url: string };
      const base = process.env.PE_WEB_URL ?? "http://localhost:3000";
      const form = new FormData();
      form.append("url", url);

      let payload: {
        error?: string;
        jobId?: string;
        fileName?: string;
        pages?: unknown[];
        blocks?: { id: string; page: number; kind: string; md: string }[];
      };
      try {
        const response = await fetch(`${base}/api/pdf-audit/parse`, { method: "POST", body: form });
        payload = (await response.json()) as typeof payload;
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `parse failed (${response.status})`);
        }
      } catch (error) {
        throw new Error(
          `Couldn't parse the spec at ${base} (${message(error)}). Is the /family-types web server running? Set PE_WEB_URL if it's on another port.`,
        );
      }

      const blocks = (payload.blocks ?? []).map(({ id, page, kind, md }) => ({
        id,
        page,
        kind,
        md,
      }));
      const document = ctx.getDoc() as FamilyTypesDocument;
      document.doc = {
        parseId: payload.jobId ?? null,
        fileName: payload.fileName ?? "document.pdf",
        blocks,
      };
      await ctx.setDoc(document);

      return {
        parseId: payload.jobId,
        fileName: payload.fileName,
        pageCount: payload.pages?.length ?? 0,
        blockCount: blocks.length,
        tableBlockIds: blocks.filter((block) => block.kind === "table").map((block) => block.id),
      };
    },

    refresh_snapshot: async (_input, ctx) => {
      let raw: unknown;
      try {
        // Unknown keys pass through POST /call untyped; typegen types this op later.
        raw = await (caller().call as (key: string, request?: unknown) => Promise<unknown>)(
          "family.editor.snapshot",
          {},
        );
      } catch (error) {
        throw new Error(
          `family.editor.snapshot failed (${message(error)}). The op may not be registered on this host, or no family is open in the editor.`,
        );
      }
      const snapshot = coerceSnapshot(raw);
      if (!snapshot) throw new Error(`Unexpected snapshot shape: ${shortJson(raw)}`);
      snapshot.takenAt = new Date().toISOString();

      // Preserve existing cells: getDoc returns the whole document, we replace only snapshot.
      const document = ctx.getDoc() as FamilyTypesDocument;
      document.snapshot = snapshot;
      await ctx.setDoc(document);

      return {
        familyName: snapshot.familyName,
        typeNames: snapshot.typeNames,
        parameterCount: snapshot.parameters.length,
      };
    },

    push: async (_input, ctx) => {
      const document = ctx.getDoc() as FamilyTypesDocument;
      const staged = Object.entries(document.cells).filter(([, cell]) => cell.staged != null);
      if (staged.length === 0) return { applied: 0, failures: [] };
      const attention = staged.filter(([, cell]) => cell.review === "attention");
      if (attention.length > 0) {
        throw new Error(
          `Push blocked: ${attention.length} staged cell${attention.length === 1 ? "" : "s"} need review.`,
        );
      }

      const edits = staged.map(([key, cell]) => {
        const { paramName, typeName } = splitCellKey(key);
        return isFormulaCellKey(key)
          ? { key, paramName, formula: cell.staged ?? "" }
          : { key, paramName, typeName, value: cell.staged ?? "" };
      });

      let raw: unknown;
      try {
        raw = await (caller().call as (key: string, request?: unknown) => Promise<unknown>)(
          "family.editor.apply",
          { edits: edits.map(({ key: _key, ...edit }) => edit) },
        );
      } catch (error) {
        throw new Error(`family.editor.apply failed (${message(error)}).`);
      }

      const results =
        (raw as { results?: { index?: number; ok?: boolean; error?: string }[] } | null)?.results ??
        [];
      const failures: { key: string; error: string }[] = [];
      const failedKeys = new Set<string>();
      results.forEach((result, index) => {
        if (result.ok === false) {
          const key = edits[result.index ?? index]?.key ?? "?";
          failures.push({ key, error: result.error ?? "failed" });
          failedKeys.add(key);
        }
      });

      // Fold successful staged values into the snapshot and clear those cells; failed
      // edits stay staged so the engineer can retry them.
      for (const [key, cell] of staged) {
        if (failedKeys.has(key)) continue;
        const { paramName, typeName } = splitCellKey(key);
        const param = document.snapshot?.parameters.find((p) => p.name === paramName);
        const value = cell.staged;
        if (param && value != null) {
          if (isFormulaCellKey(key)) param.formula = value;
          else param.valuesPerType[typeName] = value;
        }
        document.cells[key] = { review: "none" };
      }
      document.pushedAt = new Date().toISOString();
      await ctx.setDoc(document);

      return { applied: staged.length - failures.length, failures };
    },
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function createParameterLinksCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers {
  const caller = new HostRpcCaller({ hostBaseUrl: resolveHostBaseUrl(options.hostBaseUrl) });

  return {
    refresh: async (_input, ctx) => {
      const data = await callParameterLinks(caller, "revit.detail.parameter-links", {
        includeEvaluation: true,
      });
      const document = ctx.getDoc() as ParameterLinksDocument;
      document.profile = data.profile ?? null;
      document.draftProfile ??= data.profile ?? null;
      document.evaluation = data.evaluation ?? null;
      document.status = data.status;
      document.profileChanged = data.profileChanged;
      document.appliedWriteCount = data.appliedWriteCount;
      await ctx.setDoc(document);
      return summarizeParameterLinks(data);
    },

    preview: async (input, ctx) => {
      const { profile } = input as { profile: ParameterLinkProfile };
      const document = ctx.getDoc() as ParameterLinksDocument;
      requireCurrentParameterLinksDraft(document, profile);
      const data = await callParameterLinks(caller, "revit.apply.parameter-links", {
        profile,
        previewOnly: true,
        reconcile: false,
      });
      const latest = ctx.getDoc() as ParameterLinksDocument;
      requireCurrentParameterLinksDraft(latest, profile);
      latest.evaluation = data.evaluation ?? null;
      latest.status = data.status;
      latest.profileChanged = data.profileChanged;
      latest.appliedWriteCount = data.appliedWriteCount;
      await ctx.setDoc(latest);
      return summarizeParameterLinks(data);
    },

    apply: async (input, ctx) => {
      const { profile } = input as { profile: ParameterLinkProfile };
      const document = ctx.getDoc() as ParameterLinksDocument;
      requireCurrentParameterLinksDraft(document, profile);
      const data = await callParameterLinks(caller, "revit.apply.parameter-links", {
        profile,
        previewOnly: false,
        reconcile: true,
      });
      const latest = ctx.getDoc() as ParameterLinksDocument;
      const hasErrors =
        data.evaluation?.issues.some((issue) => issue.severity === "error") ?? false;
      if (!hasErrors) {
        latest.profile = data.profile ?? null;
        if (sameParameterLinkProfile(latest.draftProfile ?? latest.profile, profile))
          latest.draftProfile = data.profile ?? null;
      }
      latest.evaluation = data.evaluation ?? null;
      latest.status = data.status;
      latest.profileChanged = data.profileChanged;
      latest.appliedWriteCount = data.appliedWriteCount;
      await ctx.setDoc(latest);
      return summarizeParameterLinks(data);
    },
  };
}

function requireCurrentParameterLinksDraft(
  document: ParameterLinksDocument,
  reviewed: ParameterLinkProfile,
) {
  if (!sameParameterLinkProfile(document.draftProfile ?? document.profile, reviewed))
    throw new Error("Draft changed; preview again.");
}

function sameParameterLinkProfile(
  left: ParameterLinkProfile | null | undefined,
  right: ParameterLinkProfile | null | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Map a family.editor.snapshot response loosely onto the snapshot shape. */
function coerceSnapshot(raw: unknown): FamilyTypesSnapshot | null {
  const direct = familyTypesSnapshotSchema.safeParse(raw);
  if (direct.success) return direct.data;
  const record = raw as Record<string, unknown> | null;
  for (const key of ["data", "snapshot", "result"]) {
    const nested = record?.[key];
    if (nested) {
      const parsed = familyTypesSnapshotSchema.safeParse(nested);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

async function callParameterLinks(
  caller: HostRpcCaller,
  key: "revit.detail.parameter-links" | "revit.apply.parameter-links",
  request: RevitDetailParameterLinks.Req.Request | RevitApplyParameterLinks.Req.Request,
): Promise<ParameterLinksData> {
  let raw: unknown;
  try {
    raw =
      key === "revit.detail.parameter-links"
        ? await caller.call(key, request as RevitDetailParameterLinks.Req.Request)
        : await caller.call(key, request as RevitApplyParameterLinks.Req.Request);
  } catch (error) {
    throw new Error(`${key} failed (${message(error)}).`);
  }
  const parsed = parameterLinksDataSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Unexpected ${key} response: ${shortJson(raw)}`);
  return parsed.data;
}

function summarizeParameterLinks(data: ParameterLinksData) {
  return {
    definitionCount: data.profile?.definitions.length ?? 0,
    assignmentCount: data.profile?.assignments.length ?? 0,
    projectedWrites: data.evaluation?.changedWriteCount ?? 0,
    issues: data.evaluation?.issues.length ?? 0,
    appliedWrites: data.appliedWriteCount,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortJson(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 300) ?? String(value);
  } catch {
    return String(value);
  }
}
