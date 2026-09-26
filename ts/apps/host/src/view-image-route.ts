import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse as Response } from "effect/unstable/http";

/**
 * Where `RevitViewImageExporter` writes: `Path.GetTempPath()/pe-view-captures`. A quarantined `pe-revit` session
 * runs Revit with its own temp folder one level under the user's, so its exports land in `<tmp>/<session>/pe-view-captures`.
 */
const viewImageRoots = async (tmp = tmpdir()): Promise<string[]> => {
  const entries = await readdir(tmp, { withFileTypes: true }).catch(() => []);
  return [
    join(tmp, "pe-view-captures"),
    ...entries.filter((e) => e.isDirectory()).map((e) => join(tmp, e.name, "pe-view-captures")),
  ];
};

const shaPattern = /^\/view-image\/([0-9a-f]{64})\.png$/;

// ponytail: path -> (mtime, size, sha) memo so a lookup re-hashes only PNGs that changed; unbounded, captures are few.
const shaMemo = new Map<string, { mtimeMs: number; size: number; sha: string }>();

const shaOf = async (path: string): Promise<string | null> => {
  const info = await stat(path).catch(() => null);
  if (!info) return null;
  const hit = shaMemo.get(path);
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.sha;
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return null;
  const sha = createHash("sha256").update(bytes).digest("hex");
  shaMemo.set(path, { mtimeMs: info.mtimeMs, size: info.size, sha });
  return sha;
};

/**
 * Serves a `revit.context.view-image` PNG by its registration's `imageSha256`. The caller names only a sha,
 * never a path; bytes are hashed from disk, so an overwritten or stale export 404s instead of drawing
 * under a registration it no longer matches.
 */
async function readViewImage(roots: string[], sha: string): Promise<Buffer | null> {
  for (const root of roots) {
    const names = await readdir(root).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith(".png"))) {
      const path = join(root, name);
      if ((await shaOf(path)) === sha) return readFile(path).catch(() => null);
    }
  }
  return null;
}

export const viewImageRoute = (roots: () => Promise<string[]> = viewImageRoots) =>
  HttpRouter.add("GET", "/view-image/*", (req) =>
    Effect.gen(function* () {
      const sha = shaPattern.exec(new URL(req.url, "http://host").pathname)?.[1];
      if (!sha) return Response.empty({ status: 400 });
      const bytes = yield* Effect.promise(async () => readViewImage(await roots(), sha));
      return bytes
        ? Response.uint8Array(bytes, { contentType: "image/png" })
        : Response.empty({ status: 404 });
    }),
  );
