// Client and person names that must never ship in an example Pod. The list is machine-local
// (`.private/banned-names.txt`, one term per line, gitignored) because the names are themselves
// the secret; without the file the hygiene tests still run their public patterns.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(import.meta.dirname, "../../../../.private/banned-names.txt");

/** One case-insensitive alternation of the private names, or `null` when the list is absent. */
export const bannedNames = (): RegExp | null => {
  if (!existsSync(file)) return null;
  const terms = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  return terms.length ? new RegExp(terms.join("|"), "i") : null;
};
