/**
 * CAPTURES — the one picture currency (pages ledger, 2026-10-04). Every successful
 * `revit.context.view-image` answer through `/call`, whoever asked (web, pea CLI, the
 * `capture_view` tool), is kept here: the PNG once per sha under `blobs/`, and one receipt per
 * taking appended to `receipts.jsonl`. `GET /captures` lists the receipts newest first and
 * `GET /captures/<sha>.png` serves a blob from this store only.
 *
 * The store is product-wide (`<product>/state/captures`), not per host service, so a dev host and
 * the installed host draw the same `<img src="/captures/<sha>.png">`.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";
import { captureReceiptSchema, captureUrl, type CaptureReceipt } from "@pe/agent-contracts";
import { productPathNames } from "@pe/host-contracts/contracts";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import { productRoot } from "./host-ownership.ts";
import { isNavigation, type SpaFallback } from "./ops-catalog.ts";

const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

export class CaptureStore {
  private readonly blobs: string;
  private readonly receipts: string;
  constructor(root: string) {
    this.blobs = join(root, "blobs");
    this.receipts = join(root, "receipts.jsonl");
  }

  blobPath(sha: string) {
    return join(this.blobs, `${sha}.png`);
  }

  /** Keep one taking: the blob if this sha is new, then one appended receipt. */
  async keep(
    bytes: Buffer,
    facts: Pick<CaptureReceipt, "origin" | "document" | "view" | "focus" | "registration">,
  ): Promise<CaptureReceipt> {
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (facts.registration && facts.registration.imageSha256 !== sha)
      throw Error(
        `the exported PNG hashes to ${sha}, not the registration's ${facts.registration.imageSha256}; the file changed after Revit registered it`,
      );
    const path = this.blobPath(sha);
    await mkdir(this.blobs, { recursive: true });
    // Content-addressed: an existing blob already holds these bytes. A fresh one lands by rename so
    // a reader never sees half a PNG under its sha.
    // FOOTGUN: on Windows a rename over a file another process holds open fails EPERM, so never
    // rename over an existing blob.
    if (!(await stat(path).catch(() => null))) {
      const partial = `${path}.${randomUUID()}.partial`;
      await writeFile(partial, bytes);
      await rename(partial, path);
    }
    const receipt = captureReceiptSchema.parse({
      id: randomUUID(),
      sha,
      at: new Date().toISOString(),
      byteSize: bytes.length,
      url: captureUrl(sha),
      ...facts,
    });
    // ponytail: one small appendFile per taking is one write call; two hosts appending at once do
    // not interleave a line. A lock arrives only if a torn line is ever seen.
    await appendFile(this.receipts, `${JSON.stringify(receipt)}\n`);
    return receipt;
  }

  /** Every receipt, newest first. A line that is not a receipt is a corrupt store and throws. */
  async list(): Promise<CaptureReceipt[]> {
    const text = await readFile(this.receipts, "utf8").catch((error: unknown) => {
      if (isMissing(error)) return "";
      throw error;
    });
    return text
      .split("\n")
      .flatMap((line, index) => {
        if (!line.trim()) return [];
        const parsed = captureReceiptSchema.safeParse(JSON.parse(line));
        if (!parsed.success)
          throw Error(
            `${this.receipts}:${index + 1} is not a capture receipt: ${parsed.error.message}`,
          );
        return [parsed.data];
      })
      .reverse();
  }

  async blob(sha: string): Promise<Buffer | null> {
    return readFile(this.blobPath(sha)).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
  }
}

let store: CaptureStore | undefined;
export const hostCaptures = () =>
  (store ??= new CaptureStore(
    join(productRoot(), productPathNames.stateDirectoryName, "captures"),
  ));

type ViewImageAnswer = {
  filePath?: unknown;
  view?: { elementId?: unknown; label?: unknown } | null;
  registration?: { imageSha256?: unknown } | null;
};
type ViewImageRequest = { focus?: CaptureReceipt["focus"] } | null | undefined;

/** The receipt's origin from the /call attribution: a web or page path, else the actor. */
export const captureOrigin = (origin: string, actor: string | undefined) =>
  /^(?:web|page):./.test(origin) ? origin : actor === "agent" ? "agent" : "human";

/**
 * Register one `revit.context.view-image` answer. The PNG is read from the path the op returned
 * (a quarantined session writes under its own temp folder, so the path is the only honest
 * locator). A failure fails the `/call`: an answer whose picture was not kept would hand out a URL
 * that 404s.
 */
export const registerViewImage = Effect.fnUntraced(function* (
  captures: CaptureStore,
  answer: unknown,
  request: unknown,
  origin: string,
  bridge: RevitBridge["Service"],
  target: { session?: string; openId?: string | null },
) {
  const value = (answer ?? {}) as ViewImageAnswer;
  if (typeof value.filePath !== "string")
    return yield* Effect.fail(new BridgeError("view-image answered without a filePath", 502));
  const filePath = value.filePath;
  const sessions = yield* bridge.list;
  const title = sessions
    .find((session) => session.sessionId === target.session)
    ?.state?.openDocuments.find((document) => document.openId === target.openId)?.title;
  const focus = (request as ViewImageRequest)?.focus ?? null;
  return yield* Effect.tryPromise({
    try: async () =>
      captures.keep(await readFile(filePath), {
        origin,
        document: {
          ...(target.openId ? { openId: target.openId } : {}),
          ...(title ? { title } : {}),
        },
        view: {
          ...(typeof value.view?.elementId === "number" ? { id: value.view.elementId } : {}),
          ...(typeof value.view?.label === "string" ? { name: value.view.label } : {}),
        },
        focus,
        registration: (value.registration as CaptureReceipt["registration"]) ?? null,
      }),
    catch: (error) =>
      new BridgeError(
        `capture not kept: ${error instanceof Error ? error.message : String(error)}`,
        500,
      ),
  });
});

const blobPattern = /^\/captures\/([0-9a-f]{64})\.png$/;
const failed = (error: unknown) =>
  Response.jsonUnsafe(
    { status: 500, title: error instanceof Error ? error.message : String(error) },
    { status: 500, headers: { "content-type": "application/problem+json" } },
  );

/** `/captures` and `/captures/<sha>.png` share one registration: find-my-way's `/captures/*`
 * already claims the bare `/captures`, so a second `add` for it is refused at boot. */
export const capturesRoute = (spa: SpaFallback, captures: () => CaptureStore = hostCaptures) =>
  HttpRouter.add("GET", "/captures/*", (req) => {
    const path = new URL(req.url, "http://host").pathname;
    if (path === "/captures" || path === "/captures/")
      return isNavigation(req)
        ? spa(req)
        : Effect.tryPromise(() => captures().list()).pipe(
            Effect.map((list) => Response.jsonUnsafe({ captures: list })),
            Effect.catch((error) => Effect.succeed(failed(error))),
          );
    // The caller names only a sha, never a path.
    const sha = blobPattern.exec(path)?.[1];
    if (!sha) return Effect.succeed(Response.empty({ status: 400 }));
    return Effect.tryPromise(() => captures().blob(sha)).pipe(
      Effect.map((bytes) =>
        bytes
          ? Response.uint8Array(bytes, {
              contentType: "image/png",
              // Content-addressed: the bytes under a sha never change.
              headers: { "cache-control": "public, max-age=31536000, immutable" },
            })
          : Response.empty({ status: 404 }),
      ),
      Effect.catch((error) => Effect.succeed(failed(error))),
    );
  });
