import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import {
  familyDraftRouteState,
  parsedDocViewSchema,
  type FamilyDraft,
  type RouteStateCommandHandlers,
} from "@pe/agent-contracts";
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

export function familySpecHandlers(): RouteStateCommandHandlers<FamilyDraft> {
  return {
    attach_spec: async (raw, ctx) => {
      const { member, source } = familyDraftRouteState.commands.attach_spec.input.parse(raw);
      const root = await folderFor(member.pod);
      if (!member.path.startsWith("settings/family/") || !member.path.endsWith(".json"))
        throw Error("Attach to a captured member in settings/family/");
      const family = JSON.parse(await readFile(safePath(root, member.path), "utf8"));
      if (!family.family?.name) throw Error("The member is not a family capture");
      const form = new FormData();
      let file: File;
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
      const bytes = await file.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
        throw Error("Source is not a PDF");
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
      if (!parsed.ok) throw Error(payload.error ?? `Parse failed (${parsed.status})`);
      const doc = parsedDocViewSchema.parse(payload);
      const dir = dirname(member.path).replaceAll("\\", "/");
      const name = basename(file.name, extname(file.name)).replace(/[^a-zA-Z0-9_-]/g, "-");
      const assetDir = `${name || "document"}-${doc.jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const folder = safePath(root, `${dir}/${assetDir}`);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "source.pdf"), Buffer.from(bytes));
      const download = async (url: string, name: string) => {
        const response = await fetch(url);
        if (!response.ok) throw Error(`Spec asset download failed (${response.status})`);
        const extension = response.headers.get("content-type")?.includes("png") ? ".png" : ".jpg";
        const path = `${name}${extension}`;
        await writeFile(join(folder, path), Buffer.from(await response.arrayBuffer()));
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
      await writeFile(safePath(root, specPath), JSON.stringify(doc, null, 2));
      const sidecar = safePath(root, `${member.path}.spec.json`);
      const temporary = `${sidecar}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ path: specPath }));
      await rename(temporary, sidecar);
      await ctx.setDoc({ ...ctx.getDoc(), spec: { member, doc } });
      return {
        member,
        specPath,
        pages: doc.pages.length,
        blocks: doc.blocks.length,
        images: doc.images.length,
      };
    },
  };
}
