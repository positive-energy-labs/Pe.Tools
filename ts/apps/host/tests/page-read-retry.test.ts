import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";

// F-W42-1/2 (review of 85600b50): a read lost before its answer or inside its body is read again, whole.
test.each(["find", "response-body"])(
  "pe.js: %s transport loss retries the whole read",
  async (door) => {
    const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8"))
      .replace("/*pe:runtime*/ null", JSON.stringify({ header: "x-pe-runtime", service: "proof" }))
      .replace("/*pe:client*/ null", "__client");
    let attempts = 0;
    const window: Record<string, any> = { addEventListener() {} };
    runInNewContext(source, {
      window,
      location: new URL("http://localhost/pages/proof/"),
      document: { querySelector: () => null },
      URL,
      URLSearchParams,
      Response,
      setTimeout: (ok: () => void) => (ok(), 1),
      clearTimeout() {},
      __client: {
        response: async () => {
          if (++attempts === 1) {
            if (door === "find") throw new TypeError("Failed to fetch");
            return new Response(
              new ReadableStream({ start: (c) => c.error(new TypeError("terminated")) }),
            );
          }
          return Response.json(door === "find" ? { capabilities: [] } : { kept: true });
        },
      },
    });
    const answer =
      door === "find" ? window.pe.find("anything") : window.pe.read("revit.context.summary");
    await expect(answer).resolves.toEqual(door === "find" ? [] : { kept: true });
    expect(attempts).toBe(2);
  },
);
