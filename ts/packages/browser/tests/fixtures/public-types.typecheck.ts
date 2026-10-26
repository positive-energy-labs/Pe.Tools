import type { BrowserPage, CdpClient } from "../../src/index.ts";

// Compile-only consumer: never called; unused @ts-expect-error fails compilation if typing erodes.
export function publicProtocolTyping(client: CdpClient, page: BrowserPage) {
  void client.send("Page.navigate", { url: "https://example.com" });
  void page.send("Runtime.evaluate", { expression: "document.title", awaitPromise: true });
  // @ts-expect-error Page.navigate requires a string URL.
  void client.send("Page.navigate", { url: 42 });
  // @ts-expect-error Runtime.evaluate awaitPromise is a boolean.
  void page.send("Runtime.evaluate", { expression: "document.title", awaitPromise: "yes" });
}

interface Summary {
  title: string;
  count: number;
  labels: readonly string[];
}

// Both public entry points infer arguments and Awaited results, including named DTOs.
export async function publicEvaluationTyping(client: CdpClient, page: BrowserPage) {
  for (const browser of [client, page]) {
    const count = await browser.evaluate(
      (selector) => document.querySelectorAll(selector).length,
      "button",
    );
    count.toFixed();
    // @ts-expect-error Callback result is inferred as number.
    count.toUpperCase();
    const summary: Summary = await browser.evaluate(
      async (labels: readonly string[]): Promise<Summary> => ({
        title: document.title,
        count: labels.length,
        labels,
      }),
      ["first", "second"] as const,
    );
    summary.title.toUpperCase();
    await browser.evaluate((tuple: readonly [string, number]) => tuple, ["a", 1] as const);
    // @ts-expect-error Callback arguments retain their types.
    await browser.evaluate((value: string) => value.length, 42);
    // @ts-expect-error Functions cannot cross the result boundary.
    await browser.evaluate(() => ({ run: () => 1 }));
    // @ts-expect-error Undefined properties are not JSON.
    await browser.evaluate(() => ({ missing: undefined }));
    // @ts-expect-error Async results must also be JSON data.
    await browser.evaluate(async () => new Date());
    // @ts-expect-error Undefined arguments are not JSON.
    await browser.evaluate((value: undefined) => String(value), undefined);
  }
}
