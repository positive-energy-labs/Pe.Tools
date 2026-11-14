/** The Page projection, with no HTTP: one descriptor per Page the host serves. */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  contributionKey,
  parseContributionKey,
  pageSlugOf,
  pageOpenUrl,
} from "@pe/agent-contracts";
import type { AdmittedPackage } from "./packages.ts";
import { productPathNames } from "@pe/host-contracts/contracts";
import { contentHomes, contentRootsReady, ContentHomeUnavailable } from "./content-roots.ts";
import { sha256Hex as sha } from "./page-artifacts.ts";

/** One Page the host serves, as anything that lists, ranks or opens Pages reads it. */
export type PageDescriptor = {
  /** `page:@pages/<folder>` or `page:@<id>/pages/<page>`; null for an unsafe or case-colliding scratch folder. */
  key: string | null;
  /** Why `key` is null; null when the Page has a key. */
  reason: string | null;
  slug: string;
  /** The host's own URL for the Page, never derived from a folder by a consumer; null when it has no key. */
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

const titleOf = (html: string, slug: string) =>
  /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || slug;

/** Scratch folder names that differ only by case, each group sorted: none of them is a Page. */
export function pageFolderCollisions(names: readonly string[]): string[][] {
  const folded = Map.groupBy(names, (name) => name.toLowerCase());
  return [...folded.values()].filter((group) => group.length > 1).map((group) => group.toSorted());
}

/** The ordinary folders under the Pages root; a dot-folder is private. */
export async function scratchPageFolders(pagesRoot: string) {
  const entries = await readdir(pagesRoot, { withFileTypes: true }).catch((error) => {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

/** The scratch Page key (the folder as named), or why the folder has none. */
export function scratchPageKey(
  slug: string,
  collisions: readonly string[][] = [],
): { key: string; reason: null } | { key: null; reason: string } {
  const twins = collisions.find((group) => group.includes(slug));
  if (twins)
    return {
      key: null,
      reason: `Page folders ${twins.map((name) => `'${name}'`).join(" and ")} differ only by case: none is a Page until all but one are renamed.`,
    };
  const parsed = parseContributionKey(`page:@pages/${slug}`);
  return parsed
    ? { key: contributionKey(parsed), reason: null }
    : {
        key: null,
        reason: `'${slug}' is not a Page folder name (letters, digits, '.', '_', single '-'): it has no key or doors until its folder is renamed.`,
      };
}

/** One Pages folder, or the product's Pages in every home, in list order (user, project, firm). */
export type PagesRoots = string | readonly string[];
export const productPagesRoots = (pointer?: string | null) =>
  contentHomes(pointer).map(home => join(home.root, productPathNames.pagesDirectoryName));

/**
 * Every scratch folder holding an `index.html`, in every home, with its key or why it has none.
 * A Page slug is unique across homes (homes freeze shape 7: Page state is keyed by slug alone), so
 * the same folder in two homes refuses both. Nothing shadows.
 */
async function scratchPages(pagesRoots: PagesRoots) {
  const found: {
    directory: string;
    folder: string;
    modified: Date;
    named: ReturnType<typeof scratchPageKey>;
  }[] = [];
  for (const pagesRoot of [pagesRoots].flat()) {
    const folders = await scratchPageFolders(pagesRoot);
    const collisions = pageFolderCollisions(folders);
    for (const folder of folders) {
      const directory = join(pagesRoot, folder);
      const facts = await stat(join(directory, "index.html")).catch(() => null);
      if (facts?.isFile())
        found.push({
          directory,
          folder,
          modified: facts.mtime,
          named: scratchPageKey(folder, collisions),
        });
    }
  }
  const bySlug = Map.groupBy(found, (page) => page.folder.toLowerCase());
  return found.map((page) => {
    const homes = new Set(
      bySlug.get(page.folder.toLowerCase())!.map((twin) => dirname(twin.directory)),
    );
    if (homes.size < 2) return page;
    const twins = bySlug.get(page.folder.toLowerCase())!.map((twin) => twin.directory);
    return {
      ...page,
      named: {
        key: null,
        reason: `Page '${page.folder}' is claimed by ${twins.join(" and ")}: none is a Page until the name is unique.`,
      },
    };
  });
}

/**
 * The folder a scratch slug names, in whichever home holds it; else the user home's (the first
 * root), unwritten yet: a new Page starts in the user home. A slug with no key names no folder.
 */
export async function scratchPageDirectory(
  slug: string,
  pagesRoots?: PagesRoots,
) {
  if (pagesRoots === undefined) {
    await contentRootsReady();
    if (!contentHomes().some(home => home.tier === "user")) throw new ContentHomeUnavailable();
    pagesRoots = productPagesRoots();
  }
  const roots = [pagesRoots].flat();
  const named = (await scratchPages(roots)).filter(
    (page) => page.folder.toLowerCase() === slug.toLowerCase(),
  );
  if (named.length) {
    // A scratch Page is its folder as named: the exact name, never another spelling or a twin.
    const page = named.find((one) => one.folder === slug);
    return page?.named.key ? { dir: page.directory, key: page.named.key } : null;
  }
  const { key } = scratchPageKey(slug);
  return key && roots[0] ? { dir: join(roots[0], slug), key } : null;
}

/** Scratch Pages: every folder under a Pages root holding an `index.html`, newest first. */
export async function scratchPageDescriptors(
  pagesRoots?: PagesRoots,
): Promise<PageDescriptor[]> {
  if (pagesRoots === undefined) { await contentRootsReady(); pagesRoots = productPagesRoots(); }
  const pages: PageDescriptor[] = [];
  for (const { directory, folder, modified, named } of await scratchPages(pagesRoots)) {
    const bytes = await readFile(join(directory, "index.html"));
    pages.push({
      ...named,
      slug: folder,
      openUrl: named.key ? pageOpenUrl(named.key) : null,
      title: titleOf(bytes.toString("utf8"), folder),
      pod: null,
      entry: { path: "index.html", sha256: sha(bytes), bytes },
      modifiedAt: modified.toISOString(),
      directory,
    });
  }
  return pages.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

/** The one Page projection: scratch Pages newest first, then the given packages' Pages by key. */
export const pageDescriptors = async (
  packages: readonly AdmittedPackage[],
  pagesRoots?: PagesRoots,
) => [...(await scratchPageDescriptors(pagesRoots)), ...packagePageDescriptors(packages)];

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
        const slug = pageSlugOf(row.key);
        if (!slug) throw Error(`Invalid Page key '${row.key}'`);
        return [
          {
            key: row.key,
            reason: null,
            slug,
            openUrl: pageOpenUrl(row.key),
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
/** One source map for host serving and payload staging, relative to this module. */
export const PAGE_LIBRARY_SOURCES = {
  "pe.js": "./pages/pe.js",
  "pe.css": "./pages/pe.css",
  "base.css": "../../../packages/kit/src/base.css",
  "revit.js": "../../web/src/revit/revit.js",
  "revit.css": "../../web/src/revit/revit.css",
  "kit/pe-kit.js": "../../../packages/kit/dist/pe-kit.js",
  "kit/pe-kit.css": "../../../packages/kit/dist/pe-kit.css",
} as const;
