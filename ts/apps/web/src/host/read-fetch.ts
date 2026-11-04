/** One GET in flight per request identity. Each caller owns its wait and response body.
 * Aborting HTTP does not cancel host work or an already queued Revit operation. */
export function createReadFetch(fetcher: typeof fetch) {
  const flights = new Map<
    string,
    {
      controller: AbortController;
      response: Promise<Response>;
      readers: number;
    }
  >();
  return async (url: string, init: RequestInit): Promise<Response> => {
    // Only bodyless GETs join: their full payload is the URL and headers. Native operation
    // POSTs keep their complete body (representation, reach, etc.) and never join here.
    if ((init.method ?? "GET").toUpperCase() !== "GET" || init.body != null)
      return fetcher(url, init);
    const signal = init.signal;
    signal?.throwIfAborted();
    const key = JSON.stringify([
      url,
      [...new Headers(init.headers)],
      init.credentials,
      init.cache,
      init.mode,
      init.redirect,
      init.integrity,
      init.referrer,
      init.referrerPolicy,
    ]);
    let flight = flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const response = fetcher(url, { ...init, signal: controller.signal });
      flight = { controller, response, readers: 0 };
      flights.set(key, flight);
      const current = flight;
      const forget = () => {
        if (flights.get(key) === current) flights.delete(key);
      };
      // Both paths release the index; the original promise still delivers failures to callers.
      void response.then(forget, forget);
    }
    const current = flight;
    current.readers++;
    return new Promise<Response>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", abort);
        current.readers--;
        // StrictMode tears down and remounts in one task; let the next reader join first.
        queueMicrotask(() => {
          if (!current.readers && flights.get(key) === current) {
            flights.delete(key);
            current.controller.abort();
          }
        });
        return true;
      };
      const abort = () => {
        if (finish()) reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      current.response.then(
        (response) => {
          if (finish()) resolve(response.clone());
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  };
}
