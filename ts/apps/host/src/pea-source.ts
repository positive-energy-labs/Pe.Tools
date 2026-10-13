import { createReadStream } from "node:fs";

// Interim detach hint only; native facts grant writes and unknown refuses. Replace with SDK
// `doc file-facts <path>` / `docFileFactsArgv` once available (acquisition-plan ?5), then delete.

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
