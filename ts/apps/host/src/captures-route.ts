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
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/http";
import {
  captureReceiptSchema,
  captureUrl,
  type CaptureReceipt,
} from "@pe/agent-contracts";
import {
  appendLine,
  readLines,
  stateKind,
  stateLog,
  type StateDirectory,
} from "@pe/host-contracts/kinds";
import { z } from "zod";

const pictureKind = stateKind({
  schema: z.unknown(),
  place: (_sha: string) => "Picture capture",
  segments: (sha: string) => ["blobs", `${sha}.png`],
});
const receiptsKind = stateLog({
  schema: captureReceiptSchema,
  place: () => "Capture receipts",
  segments: () => ["receipts.jsonl"],
});
import { hostState } from "./host-ownership.ts";
import { isNavigation, type SpaFallback } from "./ops-catalog.ts";
import { sha256Hex, writeArtifact } from "./page-artifacts.ts";

const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

/** A taking that would carry the store past its byte bound is refused; nothing is evicted. */
export class PictureStoreFull extends Schema.TaggedError<PictureStoreFull>()("PictureStoreFull", {
  message: Schema.String,
  maxBytes: Schema.Number,
}) {}

/** Chosen default (no bound existed): 1 GiB over blobs plus the receipts file (ADR 0029 rule 15). */
export const PICTURE_STORE_MAX_BYTES = 1024 ** 3;

export class PictureCaptures {
  private readonly blobs: string;
  private readonly receipts: string;
  /** Bytes on disk plus every reservation. Two concurrent takings of one new sha both count it: refused early, never written past the bound. */
  private used: Promise<number> | undefined;
  constructor(
    private readonly storage: StateDirectory,
    private readonly maxBytes: number,
    private readonly now: () => number,
  ) {
    this.blobs = join(storage.path, "blobs");
    this.receipts = receiptsKind.in(storage).path;
  }

  /** Reserve `bytes` against the bound before anything is written, or refuse. */
  private async reserve(bytes: number) {
    this.used ??= Promise.all([
      readdir(this.blobs).then(
        (names) =>
          Promise.all(names.map((name) => stat(join(this.blobs, name)).then((s) => s.size))),
        (error: unknown) => (isMissing(error) ? [] : Promise.reject(error)),
      ),
      stat(this.receipts).then(
        (s) => s.size,
        (error: unknown) => (isMissing(error) ? 0 : Promise.reject(error)),
      ),
    ]).then(([blobs, receipts]) => blobs.reduce((sum, size) => sum + size, receipts));
    const used = await this.used;
    if (used + bytes > this.maxBytes)
      throw new PictureStoreFull({
        message: `Picture store is full (${used} of ${this.maxBytes} bytes); this taking was not kept`,
        maxBytes: this.maxBytes,
      });
    this.used = Promise.resolve(used + bytes);
  }

  private isNew(sha: string) {
    return stat(this.blobPath(sha)).then(
      () => false,
      (error: unknown) => (isMissing(error) ? true : Promise.reject(error)),
    );
  }

  // Content-addressed and never renamed over: Windows refuses that while a reader holds the blob.
  private write(sha: string, bytes: Buffer) {
    return writeArtifact(this.blobs, pictureKind.in(this.storage, sha), bytes);
  }

  blobPath(sha: string) {
    return join(this.blobs, `${sha}.png`);
  }

  /** Keep one taking: the blob if this sha is new, then one appended receipt. */
  async keep(
    bytes: Buffer,
    facts: Pick<CaptureReceipt, "origin" | "document" | "view" | "focus" | "registration">,
  ): Promise<CaptureReceipt> {
    const sha = sha256Hex(bytes);
    if (facts.registration && facts.registration.imageSha256 !== sha)
      throw Error(
        `the exported PNG hashes to ${sha}, not the registration's ${facts.registration.imageSha256}; the file changed after Revit registered it`,
      );
    const receipt = captureReceiptSchema.parse({
      id: randomUUID(),
      sha,
      at: new Date(this.now()).toISOString(),
      byteSize: bytes.length,
      url: captureUrl(sha),
      ...facts,
    });
    const line = `${JSON.stringify(receipt)}\n`;
    // Every taking keeps its own receipt; only the blob is shared by sha.
    await this.reserve(((await this.isNew(sha)) ? bytes.length : 0) + Buffer.byteLength(line));
    await this.write(sha, bytes);
    // One write call per taking, through the kernel: it closes a tail a crash tore, so this
    // receipt never joins a bad line.
    appendLine(receiptsKind.in(this.storage), receipt);
    return receipt;
  }

  /**
   * Hold one blob by its hash with no receipt: an imported pod's capture is an old observation, not
   * a taking on this host. Returns the sha.
   */
  async adopt(bytes: Buffer): Promise<string> {
    const sha = sha256Hex(bytes);
    if (await this.isNew(sha)) await this.reserve(bytes.length);
    await this.write(sha, bytes);
    return sha;
  }

  /**
   * Every receipt, newest first. The log decodes per line (MAP decision log, 2026-11-11): a line
   * that is not a receipt is left out with one notice, the file is never rewritten, and every
   * other receipt stays listed. Before this, one bad line failed every listing with a 500.
   */
  async list(): Promise<CaptureReceipt[]> {
    const read = readLines(receiptsKind.in(this.storage));
    return read.kind === "ok" ? read.values.reverse() : [];
  }

  async blob(sha: string): Promise<Buffer | null> {
    return readFile(this.blobPath(sha)).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
  }
}

/** The host's one picture store; time is the layer's `Clock`. It holds no open resource between calls. */
export class PictureCaptureStore extends Context.Service<PictureCaptureStore, PictureCaptures>()(
  "pe/PictureCaptures",
) {
  static readonly layer = (
    root: StateDirectory = hostState().directory("captures"),
    maxBytes = PICTURE_STORE_MAX_BYTES,
  ) =>
    Layer.effect(
      PictureCaptureStore,
      Effect.map(
        Effect.service(Clock.Clock),
        (clock) => new PictureCaptures(root, maxBytes, () => clock.currentTimeMillisUnsafe()),
      ),
    );
}

const blobPattern = /^\/captures\/([0-9a-f]{64})\.png$/;
const failed = (error: unknown) =>
  Response.jsonUnsafe(
    { status: 500, title: error instanceof Error ? error.message : String(error) },
    { status: 500, headers: { "content-type": "application/problem+json" } },
  );

/** `/captures` and `/captures/<sha>.png` share one registration: find-my-way's `/captures/*`
 * already claims the bare `/captures`, so a second `add` for it is refused at boot. */
export const capturesRoute = (spa: SpaFallback) =>
  HttpRouter.add("GET", "/captures/*", (req) =>
    Effect.flatMap(Effect.service(PictureCaptureStore), (captures) => {
      const path = new URL(req.url, "http://host").pathname;
      if (path === "/captures" || path === "/captures/")
        return isNavigation(req)
          ? spa(req)
          : Effect.tryPromise(() => captures.list()).pipe(
              Effect.map((list) => Response.jsonUnsafe({ captures: list })),
              Effect.catch((error) => Effect.succeed(failed(error))),
            );
      // The caller names only a sha, never a path.
      const sha = blobPattern.exec(path)?.[1];
      if (!sha) return Effect.succeed(Response.empty({ status: 400 }));
      return Effect.tryPromise(() => captures.blob(sha)).pipe(
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
    }),
  );
