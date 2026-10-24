import { openBrowser, attachBrowser, connectBrowser, type BrowserPage } from "../../src/index.ts";

const [mode, home, value, target] = process.argv.slice(2);
const browser =
  mode === "attach"
    ? await attachBrowser({ endpoint: value!, home, clientId: `worker-${process.pid}` })
    : mode === "connect"
      ? await connectBrowser(value!, { home, clientId: `worker-${process.pid}` })
      : await openBrowser({ home, mode: "headless" });
let page: BrowserPage | undefined;
async function loadedTitle(title: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await page!.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    if (result.result.value === title) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Worker title did not load: ${title}`);
}
try {
  page = await browser.page(target ? { targetId: target } : undefined);
  await page.send("Page.navigate", {
    url: "data:text/html,<title>worker-" + process.pid + "</title>",
  });
  await loadedTitle(`worker-${process.pid}`);
  process.send?.({ kind: "ready", info: browser.info, targetId: page.targetId });
  process.on("message", async (message) => {
    try {
      if (message === "navigate") {
        await page!.send("Page.navigate", {
          url: "data:text/html,<title>surviving-client</title>",
        });
        await loadedTitle("surviving-client");
        process.send?.({ kind: "navigated" });
      } else if (message === "read") {
        const result = await page!.send("Runtime.evaluate", {
          expression: "document.title",
          returnByValue: true,
        });
        process.send?.({ kind: "read", value: result.result.value });
      } else if (message === "close") {
        await page!.release();
        if (mode === "connect") await browser.disconnect();
        else await browser.close();
        process.exit(0);
      } else if (message === "disconnect") {
        await browser.disconnect();
        process.exit(0);
      }
    } catch (error) {
      process.send?.({ kind: "error", error: String(error) });
    }
  });
} catch (error) {
  process.send?.({
    kind: "refused",
    error: String(error),
    code: (error as { code?: string }).code,
  });
  await browser.disconnect();
  process.exitCode = 1;
}
