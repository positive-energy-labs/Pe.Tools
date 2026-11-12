import { blobRefSchema, FAMILY_MEMBER_DIR, isFamilyMember, type Consumed } from "@pe/agent-contracts";
import { put, get } from "./action-blobs.ts";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect } from "effect";
import { commands, parsedDocViewSchema, tools, type ActionStep } from "@pe/agent-contracts";
import { z } from "zod";
import { command, io, refused, type CommandExecutor } from "./command-executor.ts";
import { runPods, type PodDependencies } from "./family-actions.ts";
import { podFolder } from "./settings.ts";
import { userWritable } from "./content-homes.ts";
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
    if (!path.startsWith(FAMILY_MEMBER_DIR)) throw Error("Expected a family spec asset");
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
      // Attaching writes the spec and its assets into the Pod: a shared Pod is copied to the user root first.
      const root = userWritable(
        await runPods(deps, podFolder(member.pod, { podsRoot: deps.podsRoot })),
      );
      // Every refusal here names the next step: the caller is a person or Pea, neither reads this file.
      const save = `Save the open family first: stage writeIntent["family.capture"].edit = { "value": { "pod": "${member.pod}" } } in Family Work and run family.capture; it files the family under ${FAMILY_MEMBER_DIR} and returns the member to attach to.`;
      if (!isFamilyMember(member.path))
        throw refused(
          `'${member.path}' is not a saved family: a cut sheet attaches to a .json member under ${FAMILY_MEMBER_DIR}. ${save}`,
          "family.spec.member",
        );
      const memberBytes = await readFile(safePath(root, member.path)).catch(() => {
        throw refused(`Pod '${member.pod}' has no member '${member.path}'. ${save}`, "family.spec.member");
      });
      const family = JSON.parse(memberBytes.toString("utf8"));
      if (!family.family?.name)
        throw refused(
          `'${member.path}' is not a family model (it has no family.name). ${save}`,
          "family.spec.member",
        );
      // A path or URL is read once, here; its bytes are retained by digest and the read is a
      // consumed fact, so resume and recovery see the same PDF the admission saw (cdb265c9).
      const read = async (): Promise<{ bytes: Uint8Array; name: string }> => {
        if ("digest" in source) return { bytes: await get(source), name: source.fileName };
        if ("path" in source)
          return {
            bytes: await readFile(source.path).catch((error: NodeJS.ErrnoException) => {
              throw refused(
                `The host cannot read '${source.path}' (${error.code ?? error.message}). Give an absolute path to a PDF on the host's machine, a URL, or upload the file.`,
                "family.spec.source",
              );
            }),
            name: source.path,
          };
        const response = await fetch(source.url).catch((error: Error) => {
          throw refused(`PDF download failed: ${error.message}`, "family.spec.source");
        });
        if (!response.ok)
          throw refused(`PDF download failed (${response.status}) for ${source.url}`, "family.spec.source");
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          name: new URL(source.url).pathname || "document.pdf",
        };
      };
      const fetched = await read();
      const file = new File([new Uint8Array(fetched.bytes)], basename(fetched.name) || "document.pdf", {
        type: "application/pdf",
      });
      const bytes = await file.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
        throw refused("Source is not a PDF: its bytes do not begin with %PDF-", "family.spec.source");
      const sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
      const sourceFact: Consumed[] =
        "path" in source
          ? [
              {
                kind: "file",
                probe: { path: source.path },
                expected: sha256,
                blob: await put(Buffer.from(bytes), file.name),
              },
            ]
          : "url" in source
            ? [
                {
                  kind: "capture",
                  expected: sha256,
                  probe: {
                    blob: await put(Buffer.from(bytes), file.name),
                    origin: { kind: "url", url: source.url },
                    capturedAt: new Date().toISOString(),
                  },
                },
              ]
            : [];
      return {
        consumes: [
          {
            kind: "member",
            probe: member,
            expected: createHash("sha256").update(memberBytes).digest("hex"),
          },
          ...sourceFact,
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
    run: (ctx, execution) => Effect.gen(function* () {
      const { member, doc, specPath, assets } = execution.prepared as z.infer<
        typeof preparedSpecSchema
      >;
      for (const asset of assets)
        yield* execution.step("file", "family.spec.asset", asset, () => io(async () => {
          await mkdir(dirname(asset.path), { recursive: true });
          const temporary = `${asset.path}.${randomUUID()}.tmp`;
          await writeFile(temporary, await get(asset.blob), { flag: "wx" });
          await rename(temporary, asset.path);
          return { path: asset.path, sha256: asset.blob.digest };
        }));
      yield* execution.publishWork(ctx.admission.input.work!.key, "family", [
        { path: ["spec"], value: { member, doc } },
      ]);
      return {
        member,
        specPath,
        pages: doc.pages.length,
        blocks: doc.blocks.length,
        images: doc.images.length,
      };
    }),
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
