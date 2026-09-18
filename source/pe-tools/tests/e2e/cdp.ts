// The whole e2e helper: trusted CDP input on a real control, and reads of the rendered DOM.
// No element.click(), no handlers, no stores, no fetch. Runtime.evaluate only locates and reads.
// Browser: `chrome-agent launch --headless`; pass its port as CDP_PORT.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Page = Awaited<ReturnType<typeof connect>>;

export async function connect(port = Number(process.env.CDP_PORT ?? 9223)) {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  };
  const send = (method: string, params: object = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      pending.set(++id, (m) =>
        m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  const read = async <T>(expression: string): Promise<T> => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        `read: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    return r.result.value as T;
  };
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const page = {
    send,
    read,
    close: () => ws.close(),
    text: () => read<string>("document.body.innerText"),
    textOf: (selector: string) =>
      read<string>(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`),
    count: (selector: string) =>
      read<number>(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length).length`,
      ),
    /** Is a visible control with this text or aria-label rendered (optionally inside `within`)? */
    has: async (name: string | RegExp, within?: string) =>
      (await read(locate(name, within))) !== null,
    url: () => read<string>("location.href"),
    async open(url: string) {
      await send("Page.navigate", { url });
      await page.until(() => read<boolean>("document.readyState === 'complete'"), "page load");
    },
    async reload() {
      await send("Page.reload", {});
      await new Promise((r) => setTimeout(r, 300));
      await page.until(() => read<boolean>("document.readyState === 'complete'"), "reload");
    },
    /** Poll until `check` is truthy; the timeout names what never appeared. */
    async until<T>(check: () => Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
      const end = Date.now() + ms;
      for (;;) {
        const v = await check().catch(() => undefined);
        if (v) return v as NonNullable<T>;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    waitText: (s: string, ms?: number) =>
      page.until(async () => (await page.text()).includes(s), `text "${s}"`, ms),
    /** Click the visible control (button, link, role=button/menuitem/tab, summary) whose text or aria-label matches. */
    async click(name: string | RegExp, within?: string) {
      const box = await page.until(
        () => read<{ x: number; y: number } | null>(locate(name, within)),
        `control ${name}`,
      );
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await send("Input.dispatchMouseEvent", {
          type,
          x: box.x,
          y: box.y,
          button: "left",
          clickCount: 1,
        });
    },
    /** Click the element matching a CSS selector (for controls with no text, e.g. a cell). */
    async clickAt(selector: string) {
      const box = await page.until(
        () =>
          read<{ x: number; y: number } | null>(
            center(
              `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length && e.getBoundingClientRect().width)`,
            ),
          ),
        selector,
      );
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await send("Input.dispatchMouseEvent", {
          type,
          x: box.x,
          y: box.y,
          button: "left",
          clickCount: 1,
        });
    },
    /** Type into whatever has focus, one trusted key event per character. */
    async type(text: string) {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: ch,
          text: ch,
          unmodifiedText: ch,
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
    },
    async press(key: keyof typeof KEYS, modifiers = 0) {
      const [code, vk] = KEYS[key];
      const text = key === "Enter" ? "\r" : undefined;
      await send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key,
        code,
        windowsVirtualKeyCode: vk,
        modifiers,
      });
      if (text) await send("Input.dispatchKeyEvent", { type: "char", key, text, modifiers });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: vk,
        modifiers,
      });
    },
    /** Evidence: DOM dump + screenshot into the run directory. */
    async dump(dir: string, name: string) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${name}.html`),
        await read<string>("document.documentElement.outerHTML"),
      );
      writeFileSync(join(dir, `${name}.txt`), await page.text());
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
    },
  };
  return page;
}

const KEYS = {
  Enter: ["Enter", 13],
  Escape: ["Escape", 27],
  Delete: ["Delete", 46],
  Backspace: ["Backspace", 8],
  Tab: ["Tab", 9],
  a: ["KeyA", 65],
} as const;
export const CTRL = 2;

const center = (el: string) => `(() => {
  const el = ${el};
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
})()`;

const locate = (name: string | RegExp, within?: string) =>
  center(`(() => {
    const want = ${name instanceof RegExp ? name.toString() : JSON.stringify(name)};
    const root = ${within ? `document.querySelector(${JSON.stringify(within)})` : "document"};
    if (!root) return null;
    const labels = (e) => [e.getAttribute("aria-label"), e.innerText].map((s) => (s || "").trim()).filter(Boolean);
    const hit = (e) => labels(e).some((l) => typeof want === "string" ? l === want : want.test(l));
    return [...root.querySelectorAll("button, a, [role=button], [role=menuitem], [role=tab], [role=option], [role=combobox], summary")]
      .find((e) => hit(e) && e.getClientRects().length > 0) ?? null;
  })()`);

/**
 * Run one journey: `E2E_LABEL=green|red node tests/e2e/j5.ts`. Writes steps, the failing
 * assertion (if any), and DOM dumps under `.artifacts/proof/interaction/<id>-<tip7>/<label>/`.
 */
export async function journey(
  id: string,
  body: (page: Page, step: (s: string) => void, dir: string) => Promise<void>,
) {
  // The product tip under test: the last commit that touched anything but this lane.
  const tip = execSync(`git log -1 --format=%h --abbrev=7 -- ":/" ":!${import.meta.dirname}"`, {
    encoding: "utf8",
  }).trim();
  const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  const label = process.env.E2E_LABEL ?? "green";
  const dir = join(root, ".artifacts", "proof", "interaction", `${id}-${tip}`, label);
  mkdirSync(dir, { recursive: true });
  const log: string[] = [`${id} ${label} tip=${tip} web=${WEB} at ${new Date().toISOString()}`];
  const step = (s: string) => (log.push(`- ${s}`), console.log(s));
  const page = await connect();
  let failed: unknown;
  try {
    await body(page, step, dir);
    log.push("RESULT: PASS");
  } catch (error) {
    failed = error;
    log.push(`RESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  }
  await page.dump(dir, "final").catch(() => {});
  page.close();
  writeFileSync(join(dir, "run.log"), log.join("\n") + "\n");
  console.log(log.at(-1));
  process.exitCode = failed ? 1 : 0;
}

export const WEB = process.env.E2E_WEB ?? "http://127.0.0.1:5174";

/** Assert on rendered DOM text; failures are the evidence line RUN.md records. */
export function expectText(actual: string, want: string | RegExp, label: string, present = true) {
  const has = typeof want === "string" ? actual.includes(want) : want.test(actual);
  if (has !== present)
    throw new Error(`ASSERT ${label}: expected ${present ? "" : "no "}${want} in rendered text`);
}
