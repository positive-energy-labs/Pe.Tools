/**
 * /family command handlers — parse a spec sheet, capture Revit evidence, and build
 * the saved authored document into an .rfa with evidence returned.
 *
 * Authored truth and its proposal/staging lifecycle live in `route:settings`; these
 * commands only feed the sibling `route:family` slice (spec doc blocks + evidence
 * with origin stamps). Evidence is never build input — it is proof beside the model.
 */
import { resolve } from "node:path";

import {
  type FamilyDocument,
  type RouteStateCommandHandlers,
  type SettingsDocumentId,
  resolveTarget,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export { familyRouteState } from "@pe/agent-contracts";

interface EvidencePayload {
  typeNames: string[];
  parameters: {
    name: string;
    isShared: boolean;
    propertiesGroup?: string | null;
    valuesPerType: Record<
      string,
      { value?: string | null; source: string; provenance: string; formula?: string | null }
    >;
  }[];
  diagnostics: { code: string; path: string; message: string; provenance: string }[];
}

export function createFamilyCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<FamilyDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (target?: string) => new HostRpcCaller({ hostBaseUrl, bridgeSessionId: target });
  const untyped = (target?: string) => {
    const rpc = caller(target);
    return rpc.call.bind(rpc) as (key: string, request?: unknown) => Promise<unknown>;
  };

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
        images?: { id: string; page: number; category: string }[];
      };
      try {
        const response = await fetch(`${base}/api/pdf-audit/parse`, { method: "POST", body: form });
        payload = (await response.json()) as typeof payload;
        if (!response.ok || payload.error)
          throw new Error(payload.error ?? `parse failed (${response.status})`);
      } catch (error) {
        throw new Error(
          `Couldn't parse the spec at ${base} (${message(error)}). Is the web server running? Set PE_WEB_URL if it's on another port.`,
        );
      }

      const blocks = (payload.blocks ?? []).map(({ id, page, kind, md }) => ({
        id,
        page,
        kind,
        md,
      }));
      const images = (payload.images ?? []).map(({ id, page, category }) => ({
        id,
        page,
        category,
      }));
      const document = ctx.getDoc();
      document.doc = {
        parseId: payload.jobId ?? null,
        fileName: payload.fileName ?? "document.pdf",
        blocks,
        images,
      };
      await ctx.setDoc(document);

      return {
        parseId: payload.jobId,
        fileName: payload.fileName,
        pageCount: payload.pages?.length ?? 0,
        blockCount: blocks.length,
        tableBlockIds: blocks.filter((block) => block.kind === "table").map((block) => block.id),
        imageIds: images.map((image) => image.id),
      };
    },

    capture_evidence: async (input, ctx) => {
      const target = resolveTarget(input, ctx.getDoc());
      let raw: {
        familyName: string;
        modelJson: string;
        unmodeledCount: number;
        evidence: EvidencePayload;
      };
      try {
        raw = (await untyped(target)("revit.detail.family-model", {})) as typeof raw;
      } catch (error) {
        throw new Error(
          `revit.detail.family-model failed (${message(error)}). Is a family document active in the bound session?`,
        );
      }

      const document = ctx.getDoc();
      document.evidence = {
        ...raw.evidence,
        from: {
          origin: "capture",
          capturedAt: new Date().toISOString(),
          target: target ?? null,
          documentId: null,
          documentVersionToken: null,
          familyName: raw.familyName,
          rfaPath: null,
        },
      } as FamilyDocument["evidence"];
      await ctx.setDoc(document);

      return {
        familyName: raw.familyName,
        typeNames: raw.evidence.typeNames,
        parameterCount: raw.evidence.parameters.length,
        unmodeledCount: raw.unmodeledCount,
        modelJson: raw.modelJson,
      };
    },

    build_evidence: async (input, ctx) => {
      const { documentId, outputPath, modelDirectory } = input as {
        documentId: SettingsDocumentId;
        outputPath?: string;
        modelDirectory?: string;
      };
      const target = resolveTarget(input, ctx.getDoc());

      // Build the SAVED revision — read it through the same open path every consumer uses.
      const opened = (await untyped(target)("settings.document.open", {
        documentId: {
          moduleKey: documentId.moduleKey,
          rootKey: documentId.rootKey,
          relativePath: documentId.relativePath,
        },
        includeComposedContent: false,
      })) as { rawContent: string; metadata?: { versionToken?: { value?: string } | null } };

      // Resolve host-side: Revit resolves relative paths against ITS cwd (Program Files → denied).
      const rfaPath =
        outputPath ??
        resolve(`.artifacts/tmp/family/${documentId.relativePath.replace(/\//g, "-")}.rfa`);

      let built: { familyName?: string; outputPath?: string; evidence?: EvidencePayload };
      try {
        built = (await untyped(target)("revit.apply.family-model", {
          modelJson: opened.rawContent,
          outputPath: rfaPath,
          ...(modelDirectory ? { modelDirectory } : {}),
        })) as typeof built;
      } catch (error) {
        throw new Error(`revit.apply.family-model failed (${message(error)}).`);
      }
      if (!built.evidence)
        throw new Error("The build succeeded but returned no evidence projection.");

      const document = ctx.getDoc();
      document.evidence = {
        ...built.evidence,
        from: {
          origin: "build",
          capturedAt: new Date().toISOString(),
          target: target ?? null,
          documentId,
          documentVersionToken: opened.metadata?.versionToken?.value ?? null,
          familyName: built.familyName ?? documentId.relativePath,
          rfaPath: built.outputPath ?? rfaPath,
        },
      } as FamilyDocument["evidence"];
      await ctx.setDoc(document);

      return {
        familyName: built.familyName,
        rfaPath: built.outputPath ?? rfaPath,
        typeNames: built.evidence.typeNames,
        parameterCount: built.evidence.parameters.length,
        documentVersionToken: opened.metadata?.versionToken?.value ?? null,
      };
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
