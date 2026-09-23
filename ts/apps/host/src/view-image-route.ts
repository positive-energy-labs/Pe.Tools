import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";

/** Where `RevitViewImageExporter` writes: `Path.GetTempPath()/pe-view-captures`, same user temp as this host. */
const viewImageRoot = () => join(tmpdir(), "pe-view-captures");

const shaPattern = /^\/view-image\/([0-9a-f]{64})\.png$/;

/**
 * Serves a `revit.context.view-image` PNG by its registration's `imageSha256`. The caller names only a sha,
 * never a path; bytes are re-hashed on every read, so an overwritten or stale export 404s instead of drawing
 * under a registration it no longer matches.
 */
async function readViewImage(root: string, sha: string): Promise<Buffer | null> {
  const names = await readdir(root).catch(() => [] as string[]);
  // ponytail: hashes every PNG in the root per request; key a name->(mtime,sha) memo if captures pile up.
  for (const name of names.filter((n) => n.endsWith(".png"))) {
    const bytes = await readFile(join(root, name)).catch(() => null);
    if (bytes && createHash("sha256").update(bytes).digest("hex") === sha) return bytes;
  }
  return null;
}

export const viewImageRoute = (root = viewImageRoot()) =>
  HttpRouter.add("GET", "/view-image/*", (req) =>
    Effect.gen(function* () {
      const sha = shaPattern.exec(new URL(req.url, "http://host").pathname)?.[1];
      if (!sha) return Response.empty({ status: 400 });
      const bytes = yield* Effect.promise(() => readViewImage(root, sha));
      return bytes
        ? Response.uint8Array(bytes, { contentType: "image/png" })
        : Response.empty({ status: 404 });
    }),
  );
