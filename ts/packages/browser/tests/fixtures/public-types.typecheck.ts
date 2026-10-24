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
