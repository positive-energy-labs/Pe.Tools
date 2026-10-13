/**
 * The Page projection, with no HTTP and no catalog: the libraries every Page may load, and one
 * descriptor per Page the host serves. `pages-route.ts` serves from both; the catalog (slice D)
 * teaches both; the installer staging (slice C) copies the libraries.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { contributionKey } from "@pe/agent-contracts";
import type { AdmittedPackage } from "./packages.ts";
import { productPagesRootPath } from "./product-paths.ts";

/**
 * Every library a Page loads from the host. `source` is relative to this file on the dev lane and
 * staged flat beside `Pe.Host.exe` under `pages/` when installed. `url` null: served only inside
 * another library (the tokens land in `pe.css`).
 */
export const PAGE_LIBRARIES = [
  {
    file: "pe.js",
    source: "./pages/pe.js",
    url: "/pages/pe.js",
    says: "The doors: pe.target, pe.find, pe.read, pe.do, pe.script, pe.state, pe.describe, and the bind chip.",
  },
  {
    file: "pe.css",
    source: "./pages/pe.css",
    url: "/pages/pe.css",
    says: "The house look and the product tokens, opt-in.",
  },
  {
    file: "revit.js",
    source: "../../web/src/revit/revit.js",
    url: "/pages/revit.js",
    says: "The Revit facsimile as a classic script defining `rv`.",
  },
  {
    file: "revit.css",
    source: "../../web/src/revit/revit.css",
    url: "/pages/revit.css",
    says: "The Revit facsimile's styles.",
  },
  { file: "base.css", source: "../../web/src/base.css", url: null, says: "The product tokens." },
] as const;
export type PageLibrary = (typeof PAGE_LIBRARIES)[number];

/** One Page the host serves, as anything that lists, ranks or opens Pages reads it. */
export type PageDescriptor = {
  /** `page:@pages/<slug>` or `page:@<id>/pages/<page>`; null for a scratch folder that is no canonical slug. */
  key: string | null;
  /** Why `key` is null; null when the Page has a key. */
  reason: string | null;
  slug: string;
  /** The host's own URL for the Page, never derived from a folder by a consumer; null when no route serves it (no key). */
  openUrl: string | null;
  title: string;
  /** The contributing package's manifest id; null for a scratch Page. */
  pod: string | null;
  /** The admitted entry: the package member's bytes and hash, or the scratch file's. */
  entry: { path: string; sha256: string; bytes: Uint8Array };
  /** The scratch file's mtime; null for a packaged Page (its hash is its freshness). */
  modifiedAt: string | null;
  /** The local folder; host-internal, never a key. */
  directory: string;
};

/** The syntax of one `/pages/<slug>` URL segment; only a canonical key's slug resolves to a folder. */
export const PAGE_FOLDER = /^[a-z0-9][a-z0-9_-]*$/i;

const titleOf = (html: string, slug: string) =>
  /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || slug;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The scratch Page key, or why the folder has none. */
export function scratchPageKey(
  slug: string,
): { key: string; reason: null } | { key: null; reason: string } {
  try {
    return { key: contributionKey({ kind: "page", packageId: "pages", path: slug }), reason: null };
  } catch {
    return {
      key: null,
      reason: `'${slug}' is not a lowercase slug (a-z, 0-9, single hyphens): no route serves it and it has no doors until its folder is renamed.`,
    };
  }
}

/** Scratch Pages: every folder under the Pages root holding an `index.html`, newest first. */
export async function scratchPageDescriptors(
  pagesRoot = productPagesRootPath(),
): Promise<PageDescriptor[]> {
  const pages: PageDescriptor[] = [];
  const folders = await readdir(pagesRoot, { withFileTypes: true }).catch((error) => {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  });
  for (const folder of folders) {
    // Every ordinary folder lists, so a noncanonical one never vanishes; a dot-folder is private.
    if (!folder.isDirectory() || folder.name.startsWith(".")) continue;
    const directory = join(pagesRoot, folder.name);
    const index = join(directory, "index.html");
    const facts = await stat(index).catch(() => null);
    if (!facts?.isFile()) continue;
    const bytes = await readFile(index);
    const named = scratchPageKey(folder.name);
    pages.push({
      ...named,
      slug: folder.name,
      openUrl: named.key ? `/pages/${folder.name}/` : null,
      title: titleOf(bytes.toString("utf8"), folder.name),
      pod: null,
      entry: { path: "index.html", sha256: sha(bytes), bytes },
      modifiedAt: facts.mtime.toISOString(),
      directory,
    });
  }
  return pages.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

/**
 * Packaged Pages, pure over one admitted snapshot (`listPackages()`): no read of its own, so every
 * consumer of that snapshot sees the same keys, URLs and hashes. Ordered by key.
 */
export function packagePageDescriptors(packages: readonly AdmittedPackage[]): PageDescriptor[] {
  return packages
    .flatMap((pod) =>
      pod.contributions.flatMap((row) => {
        const member = pod.members.find((one) => one.path === row.memberPath);
        if (row.kind !== "page" || !member) return [];
        const slug = `${pod.id}--${row.path.slice("pages/".length)}`;
        return [
          {
            key: row.key,
            reason: null,
            slug,
            openUrl: `/pages/${slug}/`,
            title: titleOf(Buffer.from(member.bytes).toString("utf8"), slug),
            pod: pod.id,
            entry: { path: member.path, sha256: member.sha256, bytes: member.bytes },
            modifiedAt: null,
            directory: join(pod.directory, row.path),
          },
        ];
      }),
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}
