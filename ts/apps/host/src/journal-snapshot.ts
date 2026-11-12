import { z } from "zod";
import { receiptSchema, type Receipt } from "@pe/agent-contracts";

/**
 * Decode only the current epoch. Unsupported journals grant no retained or resumed authority.
 * Null is a known older epoch (a header with a whole `version` below the current one), which the
 * journal's load discards with a notice. Everything else that does not decode throws: a header
 * that is not JSON, a version this build does not know, a corrupt line. The load keeps that file
 * and refuses actions (MAP ruling 59d4f336). Nothing else calls this.
 */
export function readJournalSnapshot(bytes: Buffer) {
  const lines = bytes.toString("utf8").split("\n");
  let header: { version?: unknown } | null;
  try {
    header = JSON.parse(lines[0]!);
  } catch {
    throw Error("Journal header is not JSON");
  }
  const version = header?.version;
  if (version !== 8) {
    if (typeof version === "number" && Number.isInteger(version) && version >= 1 && version < 8)
      return null;
    throw Error(`Unknown journal version: ${JSON.stringify(version) ?? "none"}`);
  }
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
