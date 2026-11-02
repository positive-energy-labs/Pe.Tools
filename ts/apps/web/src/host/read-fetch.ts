/** One GET in flight per request identity. Each caller owns cancellation and its response body. */
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
    if ((init.method ?? "GET").toUpperCase() !== "GET") return fetcher(url, init);
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
      void response
        .finally(() => {
          if (flights.get(key) === current) flights.delete(key);
        })
        .catch(() => {});
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
