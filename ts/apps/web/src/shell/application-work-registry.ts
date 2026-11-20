import { workKey, type WorkKey, type WorkWrite } from "@pe/agent-contracts";
import { freezePage } from "./freeze-page";

/** Pending input survives a Place leaving; accepted history belongs to the host Timeline. */
export function createApplicationWorkRegistry() {
  const entries = new Map<string, ReturnType<typeof createEntry>>();
  function createEntry(key: WorkKey) {
    const intents = new Map<
      string,
      {
        id: string;
        input: WorkWrite;
        label: string;
        status: "pending" | "refused";
        reason?: string;
      }
    >();
    const listeners = new Set<() => void>();
    let refs = 0;
    const notify = () => listeners.forEach((listener) => listener());
    const retire = (): void => {
      const id = workKey(key);
      if (!refs && !intents.size && entries.get(id) === entry) entries.delete(id);
    };
    const entry = {
      acquire() {
        refs++;
      },
      release() {
        refs--;
        retire();
      },
      pending: () => freezePage([...intents.values()]),
      retain(input: WorkWrite, label: string) {
        const id = input.press ?? crypto.randomUUID();
        intents.set(id, { id, input: structuredClone(input), label, status: "pending" });
        notify();
        return id;
      },
      discard(id: string) {
        intents.delete(id);
        notify();
        retire();
      },
      refuse(id: string, reason: string) {
        const intent = intents.get(id);
        if (intent) {
          intent.status = "refused";
          intent.reason = reason;
          notify();
        }
      },
      accept(press?: string | null) {
        if (press) {
          intents.delete(press);
          notify();
          retire();
        }
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    return entry;
  }
  return {
    acquire(key: WorkKey) {
      const id = workKey(key);
      let entry = entries.get(id);
      if (!entry) {
        entry = createEntry(key);
        entries.set(id, entry);
      }
      entry.acquire();
      let released = false;
      return {
        entry,
        release() {
          if (!released) {
            released = true;
            entry.release();
          }
        },
      };
    },
  };
}
export const applicationWorkRegistry = createApplicationWorkRegistry();
