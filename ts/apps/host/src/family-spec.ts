import { blobRefSchema, FAMILY_MEMBER_DIR, isFamilyMember, type Consumed } from "@pe/agent-contracts";
import { put, get } from "./action-blobs.ts";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { commands, parsedDocViewSchema, tools, type ActionStep } from "@pe/agent-contracts";
import { z } from "zod";
import { command, io, refused, type CommandExecutor } from "./command-executor.ts";
import { guardSend } from "./guards.ts";
import { runPods, podContext, type PodDependencies } from "./family-actions.ts";
import { podFolder, podMemberKind, writeHome } from "./settings.ts";
import { parseFamilyPdf } from "@pe/mcps/family-pdf";
import { readDerivedJson } from "@pe/mcps/held-parse";
import { LLAMA_TIER, requireLlamaCloudKey } from "@pe/mcps/llama-parse";
import { derivedFor } from "@pe/host-contracts/service-identity";
import { derivedKey,
  readDerivedIn,
  writeDerivedIn, type DerivedDir,
} from "@pe/host-contracts/kinds";
import type { RevitBridge } from "./bridge.ts";
import type { PodContext } from "./settings.ts";
import { hostOwnership, hostState } from "./host-ownership.ts";

const safePath = (root: string, path: string) => {
  const full = resolve(root, path);
  const local = relative(root, full);
  if (!local || local.startsWith("..") || isAbsolute(local)) throw Error("Invalid pod asset path");
  return full;
};
const folderFor = (pod: string, podsRoot?: PodDependencies["podsRoot"], pointer?: string | null) =>
  // effect-edge: island, phase 5
  Effect.runPromise(podFolder(pod, { podsRoot, pointer }).pipe(Effect.provide(NodeServices.layer)));

/** Assets and sidecars are served from the selected pod, without a parse cache or API key. */
export async function familySpecAsset(
  url: URL,
  podsRoot?: PodDependencies["podsRoot"],
  pointer?: string | null,
): Promise<Response> {
  try {
    // Normalized before the prefix test: `settings/family/../../x` names another Pod file.
    const path = posix.normalize((url.searchParams.get("path") ?? "").replaceAll("\\", "/"));
    if (!path.startsWith(FAMILY_MEMBER_DIR)) throw Error("Expected a family spec asset");
    const file = safePath(await folderFor(url.searchParams.get("pod") ?? "", podsRoot, pointer), path);
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

/** The largest PDF either source door reads; a cut sheet is a few MB. */
export const SPEC_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const SPEC_SOURCE_TIMEOUT_MS = 30_000;
const sourceRefused = (message: string) => refused(message, "family.spec.source");
const overCap = (what: string) =>
  sourceRefused(
    `${what} is over the ${SPEC_SOURCE_MAX_BYTES / 1024 / 1024} MB limit for a cut sheet. Attach the pages that hold the product data as a smaller PDF.`,
  );
/** A file on the host's own disk: absolute, local, regular and under the cap. The caller checks the PDF magic, for every source. */
async function readPdfPath(path: string): Promise<Uint8Array> {
  if (path.startsWith("\\\\") || path.startsWith("//"))
    throw sourceRefused(
      `'${path}' is a network or device path. Copy the PDF to a local drive and give that path, or upload the file.`,
    );
  if (!isAbsolute(path))
    throw sourceRefused(
      `'${path}' is not an absolute path. Give the full path to the PDF on the host's machine, a URL, or upload the file.`,
    );
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    throw sourceRefused(
      `The host cannot read '${path}' (${error.code ?? error.message}). Give an absolute path to a PDF on the host's machine, a URL, or upload the file.`,
    );
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw sourceRefused(`'${path}' is not a regular file. Give the path to the PDF itself.`);
    if (stat.size > SPEC_SOURCE_MAX_BYTES) throw overCap(`'${path}'`);
    return await file.readFile();
  } finally {
    await file.close();
  }
}
/** A PDF fetched once: http(s) only, no redirect followed, timed, and cut off at the cap. */
async function readPdfUrl(url: string): Promise<Uint8Array> {
  if (!["http:", "https:"].includes(new URL(url).protocol))
    throw sourceRefused(
      `Only http and https URLs are fetched, not '${url}'. For a file on this machine give { path }.`,
    );
  const failed = (error: Error) =>
    sourceRefused(
      error.name === "TimeoutError"
        ? `PDF download did not finish within ${SPEC_SOURCE_TIMEOUT_MS / 1000} s for ${url}. Download it and attach by { path }.`
        : `PDF download failed for ${url}: ${(error.cause as Error | undefined)?.message ?? error.message}. A redirect is not followed: give the PDF's final URL, or download it and attach by { path }.`,
    );
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(SPEC_SOURCE_TIMEOUT_MS),
  }).catch((error: Error) => {
    throw failed(error);
  });
  if (!response.ok || !response.body)
    throw sourceRefused(`PDF download failed (${response.status}) for ${url}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > SPEC_SOURCE_MAX_BYTES) throw overCap(url);
      chunks.push(chunk);
    }
  } catch (error) {
    await response.body.cancel().catch(() => {});
    throw error instanceof Error && !("refusal" in error) ? failed(error) : error;
  }
  return Buffer.concat(chunks);
}

/** The family parse's identity; bump the revision when the request or the kept shape changes. */
const FAMILY_PARSER = `llamaparse/${LLAMA_TIER}/family/1`;
type ParsedDoc = z.infer<typeof parsedDocViewSchema>;
type KeptFamilyParse = { doc: ParsedDoc; assets: Map<string, Buffer> };
/** Every render a kept view names: there, `screenshotUrl` and `url` hold an asset name, not a URL. */
const assetNames = (doc: ParsedDoc) => [
  ...doc.pages.flatMap((page) => (page.screenshotUrl ? [page.screenshotUrl] : [])),
  ...doc.images.map((image) => image.url),
];
/**
 * A family parse kept in the derived store (ADR 0037 rule 6): the view and each render the parser
 * made, keyed by the PDF's bytes. Null unless every part is there, so a hit parses and fetches nothing.
 */
function keptFamilyParse(store: DerivedDir, pdf: Uint8Array): KeptFamilyParse | null {
  const doc = readDerivedJson(store, derivedKey(pdf, FAMILY_PARSER), parsedDocViewSchema);
  if (!doc) return null;
  const assets = new Map<string, Buffer>();
  for (const name of assetNames(doc)) {
    const asset = readDerivedIn(store, derivedKey(pdf, `${FAMILY_PARSER}/${name}`));
    if (!asset) return null;
    assets.set(name, Buffer.from(asset.bytes));
  }
  return { doc, assets };
}

const assetSchema = z.strictObject({ path: z.string(), blob: blobRefSchema });
const preparedSpecSchema = z.strictObject({
  member: z.strictObject({ pod: z.string(), path: z.string() }),
  doc: parsedDocViewSchema,
  specPath: z.string(),
  assets: z.array(assetSchema),
});

export function familySpecExecutor(deps: PodDependencies = {}, bridge?: RevitBridge["Service"]): CommandExecutor {
  const parsePdf = deps.parsePdf ?? parseFamilyPdf;
  return command(commands["family.attach-spec"], preparedSpecSchema, {
    bind: async (ctx) => {
      const { member, source, work: handle } = ctx.admission.input;
      // Guard 3 (ADR 0038): the parse below uploads this PDF to LlamaCloud. A person's attach runs;
      // anyone else's is held before a byte is read or sent.
      guardSend(
        ctx.caller,
        {
          service: "llamaparse",
          path: "path" in source ? source.path : "url" in source ? source.url : basename(source.fileName),
          target: `${member.pod}: ${member.path}`,
        },
        "LlamaCloud, the hosted PDF parser",
      );
      if (!handle) throw refused("Reviewed Family Work is required");
      await ctx.selectWork(tools.family.work, handle, () => ({
        cells: [],
        facts: [["reading"], ["spec"]],
      }));
      // Attaching writes the spec and its assets into the Pod, in whichever home holds it.
      const pods: PodContext = bridge ? await podContext(deps, bridge, ctx.admission.target.kind === "document" ? ctx.admission.target.ref : undefined) : { podsRoot: deps.podsRoot };
      const root = await runPods(deps, podFolder(member.pod, pods));
      // The parse and any vendor download are kept once for the project the Pod, or the PDF, sits in.
      const store = derivedFor(hostOwnership.rootPath, root, ...("path" in source ? [source.path] : []));
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
        if ("path" in source) return { bytes: await readPdfPath(source.path), name: source.path };
        // A vendor file is fetched once per project (JOURNEYS target 13), keyed by its URL.
        // ponytail: write-once, so a sheet the vendor revises at the same URL is not seen again;
        // attach the new one by { path } or upload. Add a refresh verb if that bites.
        return {
          bytes:
            readDerivedIn(store, derivedKey(source.url, "fetch/1"))?.bytes ??
            (await readPdfUrl(source.url)),
          name: new URL(source.url).pathname || "document.pdf",
        };
      };
      const fetched = await read();
      const file = new File([new Uint8Array(fetched.bytes)], basename(fetched.name) || "document.pdf", {
        type: "application/pdf",
      });
      const bytes = await file.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-")
        throw sourceRefused(
          "Source is not a PDF: its bytes do not begin with %PDF-. Export or print it to PDF and attach that.",
        );
      if ("url" in source) writeDerivedIn(store, derivedKey(source.url, "fetch/1"), Buffer.from(bytes));
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
          const pdf = Buffer.from(bytes);
          const fresh = async (): Promise<KeptFamilyParse> => {
            const doc = parsedDocViewSchema.parse(
              await parsePdf({ sender: "person", file, apiKey: requireLlamaCloudKey() }),
            );
            const assets = new Map<string, Buffer>();
            const download = async (url: string, name: string) => {
              const response = await fetch(url);
              if (!response.ok) throw Error(`Spec asset download failed (${response.status})`);
              const asset = Buffer.from(await response.arrayBuffer());
              assets.set(name, asset);
              writeDerivedIn(store, derivedKey(pdf, `${FAMILY_PARSER}/${name}`), asset);
              return name;
            };
            for (const page of doc.pages) {
              if (!page.screenshotUrl) throw Error(`Parser returned no render for page ${page.page}`);
              page.screenshotUrl = await download(page.screenshotUrl, `page-${page.page}`);
            }
            for (const [index, image] of doc.images.entries())
              image.url = await download(image.url, `image-${index}`);
            // Last, so a kept view always has its renders.
            writeDerivedIn(store, derivedKey(pdf, FAMILY_PARSER), JSON.stringify(doc));
            return { doc, assets };
          };
          const { doc, assets: renders } = keptFamilyParse(store, pdf) ?? (await fresh());
          doc.fileName = file.name;
          const dir = dirname(member.path).replaceAll("\\", "/");
          const name = basename(file.name, extname(file.name)).replace(/[^a-zA-Z0-9_-]/g, "-");
          const assetDir = `${name || "document"}-${doc.jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          const folder = safePath(root, `${dir}/${assetDir}`);
          const assets: z.infer<typeof assetSchema>[] = [];
          const retain = async (path: string, bytes: Buffer) => {
            assets.push({ path, blob: await put(bytes, basename(path)) });
          };
          await retain(join(folder, "source.pdf"), pdf);
          // The Pod keeps its own copy of each render, so the attached sheet travels with the Pod.
          const place = async (name: string) => {
            const render = renders.get(name)!;
            const path = `${name}${render[0] === 0x89 ? ".png" : ".jpg"}`;
            await retain(join(folder, path), render);
            return `${assetDir}/${path}`;
          };
          for (const page of doc.pages) page.screenshotUrl = await place(page.screenshotUrl!);
          for (const image of doc.images) image.url = await place(image.url);
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
        const pods: PodContext = bridge
          ? yield* io(() => podContext(deps, bridge, ctx.admission.target.kind === "document" ? ctx.admission.target.ref : undefined),
            )
          : { podsRoot: deps.podsRoot };
        const directory = yield* io(() => runPods(deps, podFolder(member.pod, pods)));
        for (const asset of assets)
          yield* execution.step("file", "family.spec.asset", asset, () =>
            io(async () => {
          // Through the one write door: a resumed step finds its own bytes and stops; any other
          // bytes at the path are replaced only as read, and rest in the blob store first.
          const current = await readFile(asset.path).catch(() => null);
          const held = current && createHash("sha256").update(current).digest("hex");
              if (held !== asset.blob.digest) {
                const wrote = writeHome(
                  podMemberKind.in(
                    hostState().home({ root: dirname(dirname(directory)), tier: "user" }),
                    [
                      basename(dirname(directory)),
                      basename(directory),
                      ...relative(directory, asset.path).split(/[\\\\/]/),
                    ],
                  ),
                  await get(asset.blob),
                  held,
                );
            if (!wrote.ok)
              throw Error(`Spec asset '${asset.path}' changed while it was being written.`);
              }
          return { path: asset.path, sha256: asset.blob.digest };
            }),
          );
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
