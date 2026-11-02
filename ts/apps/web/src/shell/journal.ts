import { workKey, type WorkKey } from "@pe/agent-contracts";
import { createWorkJournal } from "@pe/runtime/work-journal";
export { createWorkJournal } from "@pe/runtime/work-journal";
export type { JournalDetail, JournalMove, JournalResult, JournalWriter, WorkJournal } from "@pe/runtime/work-journal";

const shared = new Map<string, ReturnType<typeof createWorkJournal>>();
/** Mounted routes share a journal; accepted history is replayed by the durable host. */
/** Test lane: a case starts with no history (Work keys repeat across cases). */
export const forgetWorkJournals = () => shared.clear();
export function acquireWorkJournal(key: WorkKey) {
  const id = workKey(key);
  let journal = shared.get(id);
  if (!journal) shared.set(id, (journal = createWorkJournal(key)));
  return { journal, release: () => {} };
}
