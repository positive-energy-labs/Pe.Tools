import { vi } from "vite-plus/test";
import {
  resourceResponse,
  type ResourceObserver,
} from "../../../packages/runtime/src/resource-stream.ts";

/** Only the browser socket is replaced; keyed bytes and subscriptions use the real owner response. */
export function resourceEventSource(observe: ResourceObserver) {
  const sources = new Set<Source>();
  const requests: string[] = [];
  class Source {
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    readonly reader: ReadableStreamDefaultReader<Uint8Array>;
    constructor(url: string) {
      requests.push(url);
      sources.add(this);
      this.reader = resourceResponse(new Request(url), observe).body!.getReader();
      queueMicrotask(async () => {
        this.onopen?.();
        try {
          while (!this.closed) {
            const next = await this.reader.read();
            if (next.done) break;
            this.onmessage?.({ data: new TextDecoder().decode(next.value).slice(6) });
          }
        } catch {
          if (!this.closed) this.onerror?.();
        }
      });
    }
    close() {
      this.closed = true;
      sources.delete(this);
      void this.reader.cancel().catch(() => {});
    }
  }
  vi.stubGlobal("EventSource", Source);
  return {
    sources,
    requests,
    close: () => {
      for (const source of sources) source.close();
    },
  };
}
