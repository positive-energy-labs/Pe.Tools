import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import {
  commands,
  parsedDocViewSchema,
  type WorkHandle,
  type ActionStep,
} from "@pe/agent-contracts";
import { z } from "zod";
import type { CommandContext, CommandExecutor } from "./command-executor.ts";
import { runPods, type PodDependencies } from "./family-actions.ts";
import type { ActionExecution } from "./action-journal.ts";
import { podFolder } from "./settings.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";

const safePath = (root: string, path: string) => {
  const full = resolve(root, path);
  const local = relative(root, full);
  if (!local || local.startsWith("..") || isAbsolute(local)) throw Error("Invalid pod asset path");
  return full;
};
const folderFor = (pod: string) =>
  Effect.runPromise(podFolder(pod).pipe(Effect.provide(NodeServices.layer)));

/** Assets and sidecars are served from the selected pod, without a parse cache or API key. */
export async function familySpecAsset(url: URL): Promise<Response> {
  try {
    const path = url.searchParams.get("path") ?? "";
    if (!path.startsWith("settings/family/")) throw Error("Expected a family spec asset");
    const file = safePath(await folderFor(url.searchParams.get("pod") ?? ""), path);
    const bytes = await readFile(file);
    const mime =
      (
        {
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".pdf": "application/pdf",
        } as Record<string, string>
      )[extname(file)] ?? "application/octet-stream";
    return new Response(bytes, {
      headers: { "content-type": mime, "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}

const assetSchema = z
  .strictObject({ path: z.string(), bytesBase64: z.string(), sha256: z.string() })
  .refine(
    (asset) =>
      createHash("sha256").update(Buffer.from(asset.bytesBase64, "base64")).digest("hex") ===
      asset.sha256,
    "Asset bytes must match their hash",
  );
const preparedSpecSchema = z.strictObject({
  member: z.strictObject({ pod: z.string(), path: z.string() }),
  doc: parsedDocViewSchema,
  specPath: z.string(),
  assets: z.array(assetSchema),
});

export async function familySpecExecutor(
  ctx: CommandContext,
  deps: PodDependencies = {},
): Promise<CommandExecutor> {
  const { admission } = ctx;
  const { member, source } = admission.input as {
    member: { pod: string; path: string };
    source: { path: string } | { url: string } | { fileName: string; base64: string };
  };
  const handle = admission.input.work as WorkHandle | undefined;
  if (!handle) throw Error("Reviewed Family Work is required");
  let work: { doc: unknown; revision: number };
  let root: string;
  let memberBytes: Buffer;
  let file: File;
  let bytes: ArrayBuffer;
  return {
    definition: commands["family.attach-spec"],
    prepared: preparedSpecSchema,
    bind: async () => {
      work = await ctx.read.work(handle, "family");
      root = await runPods(deps, podFolder(member.pod, { podsRoot: deps.podsRoot }));
      if (!member.path.startsWith("settings/family/") || !member.path.endsWith(".json"))
        throw Error("Attach to a captured member in settings/family/");
      memberBytes = await readFile(safePath(root, member.path));
      const family = JSON.parse(memberBytes.toString("utf8"));
      if (!family.family?.name) throw Error("The member is not a family capture");
      if ("url" in source) {
        const response = await fetch(source.url);
        if (!response.ok) throw Error(`PDF download failed (${response.status})`);
        file = new File(
          [await response.arrayBuffer()],
          basename(new URL(source.url).pathname) || "document.pdf",
          { type: "application/pdf" },
        );
      } else if ("path" in source) {
        file = new File([await readFile(source.path)], basename(source.path), {
          type: "application/pdf",
        });
      } else {
        file = new File([Buffer.from(source.base64, "base64")], basename(source.fileName), {
          type: "application/pdf",
        });
      }
      bytes = await file.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
        throw Error("Source is not a PDF");
      return {
        consumes: [
          { kind: "work", handle, paths: [["reading"], ["spec"]], snapshot: work.doc },
          {
            kind: "member",
            ...member,
            sha256: createHash("sha256").update(memberBytes).digest("hex"),
            bytesBase64: memberBytes.toString("base64"),
          },
          ...("path" in source
            ? [
                {
                  kind: "file" as const,
                  path: source.path,
                  sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
                  bytesBase64: Buffer.from(bytes).toString("base64"),
                },
              ]
            : "url" in source
              ? [
                  {
                    kind: "capture" as const,
                    sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
                    bytesBase64: Buffer.from(bytes).toString("base64"),
                    origin: { kind: "url" as const, url: source.url },
                    capturedAt: new Date().toISOString(),
                  },
                ]
              : []),
        ],
        effects: [{ kind: "directory", path: dirname(safePath(root, member.path)) }],
      };
    },
    prepare: async () => {
      const form = new FormData();
      form.append("file", file);
      // The dev frontend receipt is tied to this checkout's host identity, never a guessed port.
      const port = Number(
        await readFile(
          join(productRoot(), "state", "service", `${hostOwnership.serviceName}-web.port`),
          "utf8",
        ),
      );
      if (!Number.isInteger(port) || port <= 0) throw Error("The web parser is unavailable");
      const parsed = await fetch(`http://127.0.0.1:${port}/api/pdf-audit/parse`, {
        method: "POST",
        body: form,
      });
      const payload = await parsed.json();
      if (!parsed.ok)
        throw Error(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : `Parse failed (${parsed.status})`,
        );
      const doc = parsedDocViewSchema.parse(payload);
      const dir = dirname(member.path).replaceAll("\\", "/");
      const name = basename(file.name, extname(file.name)).replace(/[^a-zA-Z0-9_-]/g, "-");
      const assetDir = `${name || "document"}-${doc.jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const folder = safePath(root, `${dir}/${assetDir}`);
      const assets: z.infer<typeof assetSchema>[] = [];
      const retain = (path: string, bytes: Buffer) =>
        assets.push({
          path,
          bytesBase64: bytes.toString("base64"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      retain(join(folder, "source.pdf"), Buffer.from(bytes));
      const download = async (url: string, name: string) => {
        const response = await fetch(url);
        if (!response.ok) throw Error(`Spec asset download failed (${response.status})`);
        const extension = response.headers.get("content-type")?.includes("png") ? ".png" : ".jpg";
        const path = `${name}${extension}`;
        retain(join(folder, path), Buffer.from(await response.arrayBuffer()));
        return `${assetDir}/${path}`;
      };
      for (const page of doc.pages) {
        if (!page.screenshotUrl) throw Error(`Parser returned no render for page ${page.page}`);
        page.screenshotUrl = await download(page.screenshotUrl, `page-${page.page}`);
      }
      for (const [index, image] of doc.images.entries())
        image.url = await download(image.url, `image-${index}`);
      // The canonical JSON is named after the PDF; a member sidecar binds a family to that JSON.
      const specPath = `${dir}/${assetDir}.json`;
      retain(safePath(root, specPath), Buffer.from(JSON.stringify(doc, null, 2)));
      const sidecar = safePath(root, `${member.path}.spec.json`);
      retain(sidecar, Buffer.from(JSON.stringify({ path: specPath })));
      return { member, doc, specPath, assets };
    },
    run: async (_ctx: CommandContext, execution: ActionExecution) => {
      const { member, doc, specPath, assets } = execution.prepared as z.infer<
        typeof preparedSpecSchema
      >;
      for (const asset of assets)
        await execution.step("file", "family.spec.asset", asset, async () => {
          await mkdir(dirname(asset.path), { recursive: true });
          const temporary = `${asset.path}.${randomUUID()}.tmp`;
          await writeFile(temporary, Buffer.from(asset.bytesBase64, "base64"), { flag: "wx" });
          await rename(temporary, asset.path);
          return { path: asset.path, sha256: asset.sha256 };
        });
      await execution.publishWork(handle.key, "family", [
        { path: ["spec"], value: { member, doc } },
      ]);
      return {
        member,
        specPath,
        pages: doc.pages.length,
        blocks: doc.blocks.length,
        images: doc.images.length,
      };
    },
    recover: async (step: ActionStep) => {
      if (step.kind !== "file" || step.key !== "family.spec.asset")
        return { step, evidence: { reason: "No independent file witness" } };
      const asset = assetSchema.parse(step.input);
      const bytes = await readFile(asset.path).catch(() => null);
      const hash = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
      return hash === asset.sha256
        ? {
            step: { ...step, state: "succeeded", result: { path: asset.path, sha256: hash } },
            evidence: { path: asset.path, sha256: hash },
          }
        : { step, evidence: { path: asset.path, sha256: hash } };
    },
  };
}
