// Kept apart from product-paths.ts, whose exports are all nullary single-path resolvers (tests enumerate them).
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { contentHomes, sharedRoot, userRoot } from "@pe/host-contracts/product-paths";

/**
 * One content folder in every home, in read order (user, then shared): a reader that takes the
 * first match by item identity resolves an item in both homes to the user's copy.
 */
export const contentDirs = (name: string) => contentHomes().map((home) => join(home, name));

/** The user-root path at the same relative path as a shared-root `path`; null when `path` is not on the shared root. */
export function userTwin(path: string): string | null {
  const shared = sharedRoot();
  if (!shared || !under(shared, path) || under(userRoot(), path)) return null;
  return join(userRoot(), relative(shared, path));
}

/**
 * Writes always go to the user root (ADR 0035 rule 11). A path on the shared root maps to the same
 * relative path under the user root; the first write copies the shared item (`<kind>/<folder>`,
 * e.g. `Pods/<folder>`) there whole, so the user's copy then wins every read and the shared copy
 * is never modified. Any other path is returned unchanged.
 */
export function userWritable(path: string): string {
  const twin = userTwin(path);
  if (!twin) return path;
  const [kind, item] = relative(userRoot(), twin).split(sep);
  if (kind && item) {
    const target = join(userRoot(), kind, item);
    if (!existsSync(target)) {
      // Staged one level down in a dot-folder, as Pod import stages: no listing sees a half copy.
      const staging = join(userRoot(), kind, `.copying-${randomUUID()}`);
      mkdirSync(staging, { recursive: true });
      try {
        cpSync(join(sharedRoot()!, kind, item), join(staging, item), { recursive: true, errorOnExist: true });
        if (!existsSync(target)) renameSync(join(staging, item), target);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
  }
  return twin;
}

const under = (root: string, path: string) => {
  const away = relative(root, path);
  return away === "" || (!away.startsWith("..") && !isAbsolute(away));
};
