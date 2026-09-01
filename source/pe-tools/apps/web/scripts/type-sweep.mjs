import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [baseUrl, ...routes] = args;
if (!baseUrl || routes.length === 0) {
  console.error("usage: vp run type-sweep -- <base-url> <route> [route ...]");
  process.exit(2);
}

const playwrightUrl = pathToFileURL(
  resolve(
    import.meta.dirname,
    "../../../node_modules/.pnpm/node_modules/playwright-core/index.mjs",
  ),
);
const { chromium } = await import(playwrightUrl.href);
const executablePath = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
if (!executablePath) throw new Error("type-sweep needs Chrome or Edge");

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const browserDefault = await page.evaluate(() => {
  const probe = document.createElement("span");
  probe.textContent = "probe";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  return { fontFamily: style.fontFamily, fontSize: style.fontSize };
});

for (const routeSpec of routes) {
  const targeting = routeSpec.endsWith("#targeting");
  const route = targeting ? routeSpec.slice(0, -"#targeting".length) : routeSpec;
  await page.goto(new URL(route, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1_500);

  if (targeting) {
    const trigger = page.locator('[aria-haspopup="dialog"]').first();
    await trigger.click();
    const search = page.locator('[aria-label^="Search "]').first();
    await search.fill("__type_sweep_no_match__");
    await page.waitForTimeout(100);
  }

  const offenders = await page.evaluate((defaults) => {
    const tier = /^t-(caption|label|value|prose|title|head|display)$/;
    const visible = (element) => {
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    const hasExplicitTier = (element) => {
      for (let current = element; current; current = current.parentElement) {
        if ([...current.classList].some((name) => tier.test(name)) || current.style.fontSize)
          return true;
        if (current === document.body) return false;
      }
      return false;
    };
    const pathOf = (element) => {
      const parts = [];
      for (
        let current = element;
        current && current !== document.body;
        current = current.parentElement
      ) {
        const id = current.id ? `#${current.id}` : "";
        const classes = [...current.classList]
          .slice(0, 2)
          .map((name) => `.${CSS.escape(name)}`)
          .join("");
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName)
          : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${current.localName}${id}${classes}${nth}`);
        if (parts.length === 5) break;
      }
      return `body > ${parts.join(" > ")}`;
    };
    const inspect = (element, text) => {
      if (!visible(element)) return null;
      const style = getComputedStyle(element);
      const browserSize = style.fontSize === defaults.fontSize && !hasExplicitTier(element);
      const browserFamily = style.fontFamily === defaults.fontFamily;
      if (!browserSize && !browserFamily) return null;
      return {
        reason: [browserSize ? style.fontSize : null, browserFamily ? style.fontFamily : null]
          .filter(Boolean)
          .join(" + "),
        path: pathOf(element),
        text: text.replace(/\s+/g, " ").trim().slice(0, 80),
      };
    };

    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (!text.trim() || !(node.parentElement instanceof HTMLElement)) continue;
      const offender = inspect(node.parentElement, text);
      if (offender) found.push(offender);
    }
    for (const control of document.querySelectorAll("input, textarea, select")) {
      if (!(control instanceof HTMLElement)) continue;
      if (control.id.endsWith("-hidden-input")) continue;
      if (
        control instanceof HTMLInputElement &&
        !["text", "search", "email", "url", "tel", "password", "number"].includes(control.type)
      )
        continue;
      const text =
        control.getAttribute("placeholder") ??
        control.getAttribute("aria-label") ??
        (control instanceof HTMLSelectElement
          ? control.selectedOptions[0]?.textContent
          : control.value);
      if (!text?.trim()) continue;
      const offender = inspect(control, text);
      if (offender) found.push(offender);
    }
    return found;
  }, browserDefault);

  console.log(`${routeSpec}\t${offenders.length}`);
  for (const offender of offenders) {
    console.log(`  ${offender.reason}\t${offender.path}\t${JSON.stringify(offender.text)}`);
  }
}

await browser.close();
