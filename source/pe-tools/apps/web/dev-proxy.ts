import type { ProxyOptions } from "vite-plus";

/** Product APIs only. TanStack owns documents and server-function routes. */
export function devHostProxy(target: string): Record<string, ProxyOptions> {
  return {
    "^/(?:call|events|ops|schemas|host|sessions|doctor|docs|pe)(?:/|\\?|$)|^/api/(?:bridge|agent-controller)(?:/|\\?|$)|^/actions(?:/(?:recover|resume))?(?:\\?|$)|^/(?:family/readings|schedule-grid/readings)(?:\\?|$)":
      {
        target,
        changeOrigin: true,
        ws: true,
        // /ops is both a document and a JSON API. Sending document navigation to
        // the backend would redirect back here forever.
        bypass(req) {
          if (
            req.method === "GET" &&
            /^\/ops(?:\?|$)/.test(req.url ?? "") &&
            req.headers.accept?.includes("text/html")
          )
            return req.url;
        },
      },
  };
}
