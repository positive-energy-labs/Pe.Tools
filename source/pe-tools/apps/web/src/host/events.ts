import { useEffect } from "react";

let source: EventSource | null = null;
const listeners = new Set<(event: unknown) => void>();

export function subscribeHostEvents<T>(listener: (event: T) => void): () => void {
  listeners.add(listener as (event: unknown) => void);
  if (!source) {
    source = new EventSource("/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as unknown;
      for (const accept of listeners) accept(event);
    };
  }
  return () => {
    listeners.delete(listener as (event: unknown) => void);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

export function useHostEvents<T>(enabled: boolean, onEvent: (event: T) => void) {
  useEffect(() => {
    if (!enabled) return;
    return subscribeHostEvents(onEvent);
  }, [enabled, onEvent]);
}
