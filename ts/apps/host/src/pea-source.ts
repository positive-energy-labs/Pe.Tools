import { createReadStream } from "node:fs";

// ponytail: interim raw scan, kept only as the --detach hint for a copy-first acquisition. It never
// grants anything: authority waits for native facts on the opened copy (acquisition.ts), and an
// unknown read refuses the acquisition. Deletion frontier: the SDK's read-only
// `doc file-facts <path>` verb (generated `docFileFactsArgv`, review acquisition-plan §5) — when the
// pin carries it, replace this call with its typed receipt and delete this file.

// BasicFileInfo, the stream every .rvt carries, is UTF-16 text; its Worksharing line reads
// "Worksharing: Not enabled" for a model that was never workshared.
const WORKSHARING = Buffer.from("Worksharing: ", "utf16le");
const NOT_ENABLED = Buffer.from("Not enabled", "utf16le");

/** Whether a saved .rvt looks workshared; null when no Worksharing line is readable. */
export async function worksharingHint(path: string): Promise<boolean | null> {
  const wanted = WORKSHARING.length + NOT_ENABLED.length;
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 4 << 20 })) {
    const buffer = Buffer.concat([carry, chunk as Buffer]);
    const at = buffer.indexOf(WORKSHARING);
    if (at >= 0) {
      if (buffer.length < at + wanted) {
        carry = buffer.subarray(at);
        continue;
      }
      return !buffer.subarray(at + WORKSHARING.length, at + wanted).equals(NOT_ENABLED);
    }
    carry = buffer.subarray(Math.max(0, buffer.length - wanted + 1));
  }
  // A file that ends inside the value: what is there decides.
  const at = carry.indexOf(WORKSHARING);
  if (at < 0 || at + WORKSHARING.length >= carry.length) return null;
  const value = carry.subarray(at + WORKSHARING.length);
  return !NOT_ENABLED.subarray(0, value.length).equals(value);
}
