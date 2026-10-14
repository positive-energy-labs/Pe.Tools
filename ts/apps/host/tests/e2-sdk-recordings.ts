/** E1 acceptance recordings (beta.207) plus E2's beta.209 bootstrap verify against an empty
 * private root. Patches change the test world; SDK envelope and result shapes stay recorded. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function patch(base: unknown, changes: unknown): unknown {
  if (
    changes &&
    typeof changes === "object" &&
    !Array.isArray(changes) &&
    base &&
    typeof base === "object" &&
    !Array.isArray(base)
  ) {
    const result = { ...base } as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (!(key in result)) throw Error(`SDK recording does not contain ${key}`);
      result[key] = patch(result[key], value);
    }
    return result;
  }
  return changes;
}
export function replay(verb: string, changes: Record<string, unknown> = {}, state = "ok"): string {
  const base = JSON.parse(
    readFileSync(join(import.meta.dirname, "sdk-envelopes", `${verb}.${state}.json`), "utf8"),
  ) as unknown;
  return JSON.stringify(patch(base, changes));
}
