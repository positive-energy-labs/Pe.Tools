/** The Page projection, with no HTTP: one descriptor per Page the host serves. */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { contributionKey, parseContributionKey } from "@pe/agent-contracts";
import type { AdmittedPackage } from "./packages.ts";
import { productPagesRootPath } from "./product-paths.ts";
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

/** Scratch Pages: every folder under the Pages root holding an `index.html`, newest first. */
export async function scratchPageDescriptors(
  pagesRoot = productPagesRootPath(),
): Promise<PageDescriptor[]> {
  const pages: PageDescriptor[] = [];
  const folders = await scratchPageFolders(pagesRoot);
  const collisions = pageFolderCollisions(folders);
  for (const folder of folders) {
    const directory = join(pagesRoot, folder);
    const index = join(directory, "index.html");
    const facts = await stat(index).catch(() => null);
    if (!facts?.isFile()) continue;
    const bytes = await readFile(index);
    const named = scratchPageKey(folder, collisions);
    pages.push({
      ...named,
      slug: folder,
      openUrl: named.key ? `/pages/${folder}/` : null,
      title: titleOf(bytes.toString("utf8"), folder),
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
