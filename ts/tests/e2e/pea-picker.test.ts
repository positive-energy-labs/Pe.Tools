import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { openBrowser, type BrowserSession } from "@pe/browser";
import { connect, requirePea, setPea, PEA_PICKER } from "./cdp.ts";

let browser: BrowserSession;
let page: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  browser = await openBrowser({ mode: "headless" });
  const fixture = await browser.page({ url: "about:blank" });
  await fixture.evaluate(() => {
    document.body.innerHTML = `<button aria-label="Choose model">C</button><section data-list-popup aria-label="Choose model" hidden><div data-list><div><span><button>Pea default</button></span><span><button>default model</button></span><span><button>high</button></span></div><div role="listbox"></div></div></section>`;
    const trigger = document.querySelector("button")!;
    const menu = document.querySelector("section")!;
    const crumbs = menu.querySelectorAll("button");
    const list = menu.querySelector('[role="listbox"]')!;
    const show = (level: number) => {
      list.replaceChildren();
      for (const label of [["Claude Code", "Codex"], ["5.6 Terra"], ["Low", "High"]][level]!) {
        const option = document.createElement("button");
        option.setAttribute("role", "option");
        option.textContent = level === 0 ? `${label} ● ready` : label;
        option.onclick = () => {
          crumbs[level]!.textContent = label;
          if (level === 2) menu.hidden = true;
          else show(level + 1);
        };
        list.append(option);
      }
    };
    crumbs.forEach((crumb, i) => {
      crumb.onclick = () => show(i);
    });
    trigger.onclick = () => {
      menu.hidden = !menu.hidden;
      show(1);
    };
    return null;
  });
  page = await connect(Number(new URL(browser.info.endpoint).port), fixture.targetId);
});
afterAll(async () => {
  await page?.close();
  await browser?.close();
});

test("single picker selects and reads provider, model and effort without Access", async () => {
  await setPea(page);
  await requirePea(page);
});

test("named mutant: retired Model chip times out on the icon-only composer", async () => {
  expect(await page.count(PEA_PICKER)).toBe(1);
  await expect(
    page.until(
      async () => (await page.count('button[aria-label="Model"]')) > 0,
      "the Model chip to load",
      30,
    ),
  ).rejects.toThrow("timed out");
});
