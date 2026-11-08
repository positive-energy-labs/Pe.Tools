import { blobRefSchema } from "@pe/agent-contracts";
import { put, get } from "./action-blobs.ts";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect } from "effect";
import { commands, parsedDocViewSchema, tools, type ActionStep } from "@pe/agent-contracts";
import { z } from "zod";
import { command, refused, type CommandExecutor } from "./command-executor.ts";
import { runPods, type PodDependencies } from "./family-actions.ts";
import { podFolder } from "./settings.ts";
/** The app owns the parser address; commands never infer a frontend from a port or file. */
export class FamilyPdfParser extends Context.Service<FamilyPdfParser, {
  parse(file: File): Promise<unknown>;
}>()("pe/FamilyPdfParser") {}

const safePath = (root: string, path: string) => {
  const full = resolve(root, path);
  const local = relative(root, full);
  if (!local || local.startsWith("..") || isAbsolute(local)) throw Error("Invalid pod asset path");
  return full;
};
const folderFor = (pod: string) =>
  // effect-edge: island, phase 5
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

const assetSchema = z.strictObject({ path: z.string(), blob: blobRefSchema });
const preparedSpecSchema = z.strictObject({
  member: z.strictObject({ pod: z.string(), path: z.string() }),
  doc: parsedDocViewSchema,
  specPath: z.string(),
  assets: z.array(assetSchema),
});

export function familySpecExecutor(deps: PodDependencies = {}): CommandExecutor {
  return command(commands["family.attach-spec"], preparedSpecSchema, {
    bind: async (ctx) => {
      const { member, source, work: handle } = ctx.admission.input;
      if (!handle) throw refused("Reviewed Family Work is required");
      await ctx.selectWork(tools.family.work, handle, () => ({
        cells: [],
        facts: [["reading"], ["spec"]],
      }));
      const root = await runPods(deps, podFolder(member.pod, { podsRoot: deps.podsRoot }));
      if (!member.path.startsWith("settings/family/") || !member.path.endsWith(".json"))
        throw Error("Attach to a captured member in settings/family/");
      const memberBytes = await readFile(safePath(root, member.path));
      const family = JSON.parse(memberBytes.toString("utf8"));
      if (!family.family?.name) throw Error("The member is not a family capture");
      const file = new File([new Uint8Array(await get(source))], basename(source.fileName), {
        type: "application/pdf",
      });
      const bytes = await file.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
        throw Error("Source is not a PDF");
      return {
        consumes: [
          {
            kind: "member",
            probe: member,
            expected: createHash("sha256").update(memberBytes).digest("hex"),
          },

        ],
        effects: [{ kind: "directory", path: dirname(safePath(root, member.path)) }],
        prepare: async () => {
          if (!deps.parsePdf) throw Error("The web PDF parser is unavailable");
          const payload = await deps.parsePdf(file);
          const doc = parsedDocViewSchema.parse(payload);
          const dir = dirname(member.path).replaceAll("\\", "/");
          const name = basename(file.name, extname(file.name)).replace(/[^a-zA-Z0-9_-]/g, "-");
          const assetDir = `${name || "document"}-${doc.jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          const folder = safePath(root, `${dir}/${assetDir}`);
          const assets: z.infer<typeof assetSchema>[] = [];
          const retain = async (path: string, bytes: Buffer) => {
            assets.push({ path, blob: await put(bytes, basename(path)) });
          };
          await retain(join(folder, "source.pdf"), Buffer.from(bytes));
          const download = async (url: string, name: string) => {
            const response = await fetch(url);
            if (!response.ok) throw Error(`Spec asset download failed (${response.status})`);
            const extension = response.headers.get("content-type")?.includes("png")
              ? ".png"
              : ".jpg";
            const path = `${name}${extension}`;
            await retain(join(folder, path), Buffer.from(await response.arrayBuffer()));
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
          await retain(safePath(root, specPath), Buffer.from(JSON.stringify(doc, null, 2)));
          const sidecar = safePath(root, `${member.path}.spec.json`);
          await retain(sidecar, Buffer.from(JSON.stringify({ path: specPath })));
          return { member, doc, specPath, assets };
        },
      };
    },
    run: async (ctx, execution) => {
      const { member, doc, specPath, assets } = execution.prepared as z.infer<
        typeof preparedSpecSchema
      >;
      for (const asset of assets)
        await execution.step("file", "family.spec.asset", asset, async () => {
          await mkdir(dirname(asset.path), { recursive: true });
          const temporary = `${asset.path}.${randomUUID()}.tmp`;
          await writeFile(temporary, await get(asset.blob), { flag: "wx" });
          await rename(temporary, asset.path);
          return { path: asset.path, sha256: asset.blob.digest };
        });
      await execution.publishWork(ctx.admission.input.work!.key, "family", [
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
      await get(asset.blob);
      const bytes = await readFile(asset.path).catch((error) => {
        console.error("family-spec: asynchronous operation failed", error);
        return null;
      });
      const hash = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
      return hash === asset.blob.digest
        ? {
            step: { ...step, state: "succeeded", result: { path: asset.path, sha256: hash } },
            evidence: { path: asset.path, sha256: hash },
          }
        : { step, evidence: { path: asset.path, sha256: hash } };
    },
  });
}
