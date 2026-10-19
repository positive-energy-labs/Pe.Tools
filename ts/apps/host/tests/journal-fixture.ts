import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Receipt } from "@pe/agent-contracts";

type Journal = { receipts: Receipt[]; mappings: Record<string, string> };

/** A journal file folded to what a host loads: the last revision of each receipt, in first-commit
 * order, and every mapping. */
export async function readJournal(path: string): Promise<Journal> {
  const journal: Journal = { receipts: [], mappings: {} };
  const [, ...lines] = (await readFile(path, "utf8")).split("\n");
  for (const line of lines.filter(Boolean).map((text) => JSON.parse(text))) {
    if (line.mapping) journal.mappings[line.mapping[0]] = line.mapping[1];
    const at = journal.receipts.findIndex((r) => r.id === line.receipt?.id);
    if (line.receipt && at >= 0) journal.receipts[at] = line.receipt;
    else if (line.receipt) journal.receipts.push(line.receipt);
  }
  return journal;
}

/** Write a current (v5, one line per record) journal. */
export async function writeJournalFile(path: string, journal: Journal) {
  const lines = [
    { version: 5 },
    ...Object.entries(journal.mappings).map((mapping) => ({ mapping })),
    ...journal.receipts.map((receipt) => ({ receipt })),
  ];
  await writeFile(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

/** A current action journal holding these rows, as a host that died mid-action left it. */
export async function writeJournal<T extends { id: string }>(path: string, actions: readonly T[]) {
  const mappings: Record<string, string> = {};
  const receipts = actions.map((value) => {
    const join = { actionId: randomUUID(), requestId: randomUUID() };
    mappings[JSON.stringify(["action", value.id])] = join.actionId;
    mappings[JSON.stringify(["action-request", value.id])] = join.requestId;
    return {
      schema: 1,
      id: randomUUID(),
      revision: 1,
      at: new Date().toISOString(),
      stamp: null,
      join,
      body: { kind: "action", value },
    } as unknown as Receipt;
  });
  await writeJournalFile(path, { receipts, mappings });
}
