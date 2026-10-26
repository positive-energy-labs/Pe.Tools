import type { TypedPage } from "./typed-page.ts";

// Compile-only consumer. Unused @ts-expect-error fails if the public boundary loses its types.
export async function selectionTyping(page: TypedPage) {
  // @ts-expect-error CDP Page.navigate needs a string URL.
  await page.send("Page.navigate", { url: 42 });
  // @ts-expect-error CDP ignoreCache is a boolean.
  await page.send("Page.reload", { ignoreCache: "yes" });
  const count = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    "button",
  );
  // @ts-expect-error Browser callback result is inferred as a number.
  count.toUpperCase();
  // @ts-expect-error Callback arguments retain their declared types.
  await page.evaluate((value: string) => value.length, 42);
}
