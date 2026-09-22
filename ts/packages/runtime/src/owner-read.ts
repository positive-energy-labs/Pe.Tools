export type OwnerValue<A> = { value: A } | { error: string };

/** Active read lifetimes only. Each owner holds its own instance; no persisted or cached truth. */
export class OwnerReads {
  private readonly entries = new Map<
    string,
    {
      listeners: Set<(value: OwnerValue<unknown>) => void>;
      refresh(): void;
      close(): void;
    }
  >();

  observe<A>(
    key: string,
    read: (signal: AbortSignal) => Promise<A>,
    subscribe: (notify: () => void) => () => void,
    listener: (value: OwnerValue<A>) => void,
  ): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      const lifetime = new AbortController();
      const listeners = new Set<(value: OwnerValue<unknown>) => void>();
      let running = false;
      let dirty = false;
      const refresh = () => {
        dirty = true;
        if (running || lifetime.signal.aborted) return;
        running = true;
        void Promise.resolve().then(async () => {
          try {
            while (dirty && !lifetime.signal.aborted) {
              dirty = false;
              let result: OwnerValue<A>;
              try {
                result = { value: await read(lifetime.signal) };
              } catch (error) {
                result = { error: error instanceof Error ? error.message : String(error) };
              }
              // A notification during the read invalidates that acquisition, including failures.
              if (dirty || lifetime.signal.aborted) continue;
              for (const accept of listeners) accept(result);
            }
          } finally {
            running = false;
          }
        });
      };
      // Register first: updates racing initial acquisition use the same ordering point.
      const unsubscribe = subscribe(refresh);
      entry = {
        listeners,
        refresh,
        close: () => {
          lifetime.abort();
          unsubscribe();
        },
      };
      this.entries.set(key, entry);
    }
    const accept = listener as (value: OwnerValue<unknown>) => void;
    entry.listeners.add(accept);
    // Every attach reacquires, including reconnects that join another active observer.
    entry.refresh();
    return () => {
      entry.listeners.delete(accept);
      if (entry.listeners.size === 0 && this.entries.get(key) === entry) {
        this.entries.delete(key);
        entry.close();
      }
    };
  }
}
