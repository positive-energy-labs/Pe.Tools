// Kept apart from product-paths.ts, whose exports are all nullary single-path resolvers (tests enumerate them).
import { isAbsolute, join, relative } from "node:path";
import { contentHomes, sharedRoot, userRoot } from "@pe/host-contracts/product-paths";

/**
 * One content folder in every home, in read order (user, then shared): a reader that takes the
 * first match by item identity resolves an item in both homes to the user's copy.
 */
export const contentDirs = (name: string) => contentHomes().map((home) => join(home, name));

/** Writes always go to the user root; a write aimed into the shared root refuses (ADR 0035 rule 11). */
export function requireUserWritable(path: string): string {
  const shared = sharedRoot();
  if (shared && under(shared, path) && !under(userRoot(), path))
    throw Error(`'${path}' is in the shared content root; writes go to the user root only.`);
  return path;
}

const under = (root: string, path: string) => {
  const away = relative(root, path);
  return away === "" || (!away.startsWith("..") && !isAbsolute(away));
};
