import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { productScratchPath } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";

/**
 * The one oversize rule for every Pea tool result (pe_find, pe_read, pe_do, the full action receipt).
 * Past the cap the model gets the path, size and a short head, and the whole result sits in the product
 * scratch folder as pretty JSON so Read and Grep work on it by line. Claude Code's own fallback is one
 * unreadable line (Grep prints "[Omitted long matching line]"); the cap keeps us under it.
 */
export const RESULT_CAP_CHARS = 20_000;
const HEAD_CHARS = 1_500;
const KEEP_MS = 3 * 24 * 3_600_000;

/** Text for the model: `text` itself, or a pointer to the full `result` written under `dir`. */
export function capResultText(
  toolId: string,
  result: unknown,
  text: string,
  dir = join(productScratchPath(runtimeRoot()), "tool-output"),
): string {
  if (text.length <= RESULT_CAP_CHARS) return text;
  try {
    // A script's WriteLine output is one JSON string whose newlines are escapes, so it would still be one
    // line for Grep and Read. A long multi-line string is written as an array of its lines instead.
    const pretty =
      typeof result === "string"
        ? result
        : JSON.stringify(
            result,
            (_, value) =>
              typeof value === "string" && value.length > 500 && value.includes("\n")
                ? value.split("\n")
                : value,
            2,
          );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${toolId}-${stamp}-${Math.random().toString(36).slice(2, 8)}.${typeof result === "string" ? "txt" : "json"}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, pretty, "utf8");
    prune(dir);
    const head = pretty.slice(0, HEAD_CHARS);
    return JSON.stringify({
      spilled: true,
      note: `The ${text.length}-character result is over the ${RESULT_CAP_CHARS} cap and was written whole to this file as pretty JSON, with long multi-line text split into one array element per line. Read it with offset and limit, or Grep -n it.`,
      path,
      lines: pretty.split("\n").length,
      bytes: Buffer.byteLength(pretty),
      head: head.slice(0, head.lastIndexOf("\n") + 1 || HEAD_CHARS),
    });
  } catch (error) {
    // A scratch that cannot be written leaves the status quo (the harness's own overflow file), not a failed tool.
    console.error("tool-output spill failed", error);
    return text;
  }
}

/** Spilled files are working copies for the turn that asked, so a few days is plenty. */
function prune(dir: string): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
  }
}
