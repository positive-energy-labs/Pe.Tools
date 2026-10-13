import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

/** A current (v4) action journal holding these rows, as a host that died mid-action left it. */
export async function writeJournal<T extends { id: string }>(path: string, actions: readonly T[]) {
  const mappings: Record<string, string> = {};
  const receipts = actions.map((value) => {
    const join = { actionId: randomUUID(), requestId: randomUUID() };
    mappings[JSON.stringify(["action", value.id])] = join.actionId;
    mappings[JSON.stringify(["action-request", value.id])] = join.requestId;
    const at = new Date().toISOString();
    return {
      schema: 1,
      id: randomUUID(),
      revision: 1,
      at,
      stamp: null,
      join,
      body: { kind: "action", value },
    };
  });
  await writeFile(path, JSON.stringify({ version: 4, receipts, mappings }));
}
