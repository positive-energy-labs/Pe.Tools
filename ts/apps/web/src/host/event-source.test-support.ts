/** Browser EventSource lifecycle over the real host SSE handler, shared by host-backed journeys. */
export function hostEventSource(request: (request: Request) => Promise<Response>) {
  const fallback = globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    // The subscription POST and stream GET must reach the same host, even in jsdom's origin.
    return new URL(url, "http://host").pathname === "/pe/resource-subscriptions"
      ? request(new Request(input, init))
      : fallback(input, init);
  };
  const streams = new Set<{ close(): void }>();
  class Stream {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    private reader?: ReadableStreamDefaultReader<Uint8Array>;
    private closed = false;
    constructor(url: string) {
      streams.add(this);
      void (async () => {
        const response = await request(new Request(url));
        if (!response.ok) throw Error(await response.text());
        this.reader = response.body!.getReader();
        if (this.closed) return void this.reader.cancel();
        this.onopen?.();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!this.closed) {
          const frame = await this.reader.read();
          if (frame.done) break;
          buffer += decoder.decode(frame.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of event.split("\n"))
              if (line.startsWith("data: ")) this.onmessage?.({ data: line.slice(6) });
          }
        }
      })().catch(() => {
        if (!this.closed) this.onerror?.();
      });
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.closed = true;
      void this.reader?.cancel();
      streams.delete(this);
    }
  }
  return { Stream, streams, fetch };
}
