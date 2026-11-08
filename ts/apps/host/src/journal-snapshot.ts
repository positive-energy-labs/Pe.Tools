import { z } from "zod";
import { receiptSchema, type Receipt } from "@pe/agent-contracts";

/** Decode only the current epoch. Unsupported journals grant no retained or resumed authority. */
export function readJournalSnapshot(bytes: Buffer) {
  const lines = bytes.toString("utf8").split("\n");
  const version = JSON.parse(lines[0]!)?.version;
  if (version !== 8) return null;
  const receipts: Receipt[] = [];
  const mappings: [string, string][] = [];
  let torn = false;
  const parseReceipt = receiptSchema.parse;
  const entry = z.union([
    z.strictObject({ receipt: z.unknown() }),
    z.strictObject({ mapping: z.tuple([z.string(), z.uuid()]) }),
  ]);
  lines.slice(1).forEach((text, i) => {
    if (!text) return;
    // A complete JSON line with an invalid schema is corruption, even at the tail.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      if (i === lines.length - 2) {
        torn = true;
        return;
      }
      throw error;
    }
    const row = entry.parse(json);
    if ("receipt" in row) receipts.push(parseReceipt(row.receipt));
    else mappings.push(row.mapping);
  });
  return { receipts, mappings, torn, lines: lines.length - 1 };
}
