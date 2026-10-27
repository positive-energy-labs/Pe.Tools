import { openBrowser } from "@pe/browser";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const probeTValue = args.includes("--probe-t-value");
if (probeTValue) args.splice(args.indexOf("--probe-t-value"), 1);
const [baseUrl, ...routes] = args;
if (!baseUrl || routes.length === 0) {
  console.error("usage: vp run type-sweep -- <base-url> [--probe-t-value] <route> [route ...]");
  process.exit(2);
}

const browser = await openBrowser({ mode: "headless" });
const page = await browser.page();
await page.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Trusted input at a control's centre. `find` runs in Chrome and returns the control's box or null.
// Waits up to 15 s for the control to render, as a click on a route still loading must.
async function box(find, ...args) {
  for (const end = Date.now() + 15_000; Date.now() < end; await sleep(200)) {
    const at = await page.evaluate(find, ...args);
    if (at) return at;
  }
  throw new Error(`type-sweep: no control for ${JSON.stringify(args)}`);
}
async function mouse(at, types) {
  for (const type of types)
    await page.send("Input.dispatchMouseEvent", {
      type,
      x: at.x,
      y: at.y,
      button: type === "mouseMoved" ? "none" : "left",
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
}
const click = (at) => mouse(at, ["mouseMoved", "mousePressed", "mouseReleased"]);
const centre = (selector, text) => {
  const element = [...document.querySelectorAll(selector)].find(
    (candidate) =>
      candidate.getClientRects().length > 0 &&
      (text === null ||
        candidate.textContent.trim() === text ||
        candidate.getAttribute("aria-label") === text),
  );
  if (!element) return null;
  element.scrollIntoView({ block: "center" });
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

const browserDefault = await page.evaluate(() => {
  const probe = document.createElement("span");
  probe.textContent = "probe";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  return { fontFamily: style.fontFamily, fontSize: style.fontSize };
});

try {
  for (const routeSpec of routes) {
    const mode = routeSpec.match(/#(targeting|room|zone|field-details)$/)?.[1];
    const route = mode ? routeSpec.slice(0, -(mode.length + 1)) : routeSpec;
    const navigation = await page.send("Page.navigate", { url: new URL(route, baseUrl).href });
    if (navigation.errorText) throw new Error(`${routeSpec}: ${navigation.errorText}`);
    for (let end = Date.now() + 30_000; ; await sleep(100)) {
      const state = await page.evaluate(() => document.readyState).catch(() => "loading");
      if (state !== "loading") break;
      if (Date.now() > end) throw new Error(`${routeSpec}: document did not load`);
    }
    await sleep(1_500);

    if (mode === "targeting") {
      await click(await box(centre, '[aria-haspopup="dialog"]', null));
      await click(await box(centre, '[aria-label^="Search "]', null));
      await page.send("Input.insertText", { text: "__type_sweep_no_match__" });
      await sleep(100);
    }
    if (mode === "room") {
      await click(await box(centre, "*", "room table"));
      await page.evaluate(() => document.querySelector("tbody tr")?.click());
      await sleep(100);
    }
    if (mode === "zone") {
      await click(await box(centre, 'button[title*="sf declared"]', null));
      await sleep(100);
    }
    if (mode === "field-details") {
      await mouse(await box(centre, "button", "Field details"), ["mouseMoved"]);
      await sleep(250);
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
            ? [...current.parentElement.children].filter(
                (child) => child.tagName === current.tagName,
              )
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

    if (probeTValue) {
      const probes = await page.evaluate(() => {
        const tier = /^t-(caption|label|value|prose|title|head|display)$/;
        const visible = (element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            element.getClientRects().length > 0
          );
        };
        const pathOf = (element) => {
          const parts = [];
          for (
            let current = element;
            current && current !== document.body;
            current = current.parentElement
          ) {
            const id = current.id ? `#${current.id}` : "";
            const siblings = current.parentElement
              ? [...current.parentElement.children].filter(
                  (child) => child.tagName === current.tagName,
                )
              : [];
            const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
            parts.unshift(`${current.localName}${id}${nth}`);
            if (parts.length === 6) break;
          }
          return `body > ${parts.join(" > ")}`;
        };
        const ancestorTier = (element) => {
          for (let current = element.parentElement; current; current = current.parentElement) {
            const found = [...current.classList].find((name) => tier.test(name));
            if (found) return found;
          }
          return "body";
        };
        const sourceOf = (element) => {
          const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
          for (let fiber = key ? element[key] : null; fiber; fiber = fiber.return) {
            const stack = fiber._debugStack?.stack;
            const match = stack?.match(/\/src\/[^?\n)]+:\d+:\d+/);
            if (match) return match[0].slice(1);
          }
          return null;
        };

        return [...document.querySelectorAll(".t-value")].filter(visible).map((element) => {
          const before = getComputedStyle(element);
          const fontSize = before.fontSize;
          const lineHeight = before.lineHeight;
          element.classList.remove("t-value");
          const after = getComputedStyle(element);
          const nextFontSize = after.fontSize;
          const nextLineHeight = after.lineHeight;
          element.classList.add("t-value");
          return {
            changed: fontSize !== nextFontSize || lineHeight !== nextLineHeight,
            before: `${fontSize}/${lineHeight}`,
            after: `${nextFontSize}/${nextLineHeight}`,
            ancestorTier: ancestorTier(element),
            source: sourceOf(element),
            path: pathOf(element),
            text: (element.textContent ?? element.getAttribute("aria-label") ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80),
          };
        });
      });
      console.log(
        `${routeSpec}\tt-value ${probes.filter((probe) => probe.changed).length}/${probes.length} changed`,
      );
      for (const probe of probes) {
        console.log(
          `  ${probe.changed ? "LOAD" : "SAME"}\t${probe.before} -> ${probe.after}\t${probe.ancestorTier}\t${probe.source ?? probe.path}\t${JSON.stringify(probe.text)}`,
        );
      }
    }
  }
} finally {
  await browser.close();
}
