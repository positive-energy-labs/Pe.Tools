import { resolve } from "node:path";

import {
  readingSchema,
  type FamilyDocument,
  type RouteStateCommandHandlers,
  type SettingsDocumentId,
  bridgeSelector,
} from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";

export function createFamilyCommandHandlers(
  options: { hostBaseUrl?: string } = {},
): RouteStateCommandHandlers<FamilyDocument> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const caller = (target?: string) => new HostRpcCaller({ hostBaseUrl, bridgeSessionId: target });

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
      const target = bridgeSelector(ctx.scope);
      const rpc = caller(target);
      const raw = await rpc.call("revit.detail.family-model", {}).catch((error: unknown) => {
        throw new Error(
          `revit.detail.family-model failed (${message(error)}). Is a family document active in the bound session?`,
        );
      });

      const document = ctx.getDoc();
      document.evidence = {
        ...raw.evidence,
        reading: readingSchema.parse(raw.reading),
        origin: "capture",
        familyName: raw.familyName,
        rfaPath: null,
      };
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
      const target = bridgeSelector(ctx.scope);
      const rpc = caller(target);

      // Build the SAVED revision — read it through the same open path every consumer uses.
      const opened = await rpc.call("settings.document.open", {
        documentId,
        includeComposedContent: false,
      });
      const sourcePath = opened.metadata.documentId.stableId;
      if (!sourcePath)
        throw new Error("settings.document.open returned no absolute document path.");

      // Resolve host-side: Revit resolves relative paths against ITS cwd (Program Files → denied).
      // The default name carries a timestamp: `revit.apply.family-model` refuses to overwrite,
      // so a fixed name would make every rebuild of the same document a Conflict.
      const rfaPath =
        outputPath ??
        resolve(
          `.artifacts/tmp/family/${documentId.relativePath.replace(/\//g, "-")}-${stamp()}.rfa`,
        );

      const built = await rpc
        .call("revit.apply.family-model", {
          modelJson: opened.rawContent,
          outputPath: rfaPath,
          ...(modelDirectory ? { modelDirectory } : {}),
        })
        .catch((error: unknown) => {
          throw new Error(`revit.apply.family-model failed (${message(error)}).`);
        });
      if (!built.evidence)
        throw new Error("The build succeeded but returned no evidence projection.");

      const document = ctx.getDoc();
      document.evidence = {
        ...built.evidence,
        reading: readingSchema.parse(built.reading),
        origin: "build",
        familyName: built.familyName ?? documentId.relativePath,
        rfaPath: built.outputPath ?? rfaPath,
      };
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

/** Compact local timestamp `YYYYMMDD-HHmmss`, unique enough to keep rebuilds from colliding. */
function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
