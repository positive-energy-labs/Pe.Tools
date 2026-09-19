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
  const errors: string[] = [];
  const pending = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
      );
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

  await send("Runtime.enable");
  // Each dev launch serves deps from a fresh temp dir; a cached module graph points at the old one.
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  const page = {
    /** Uncaught page exceptions, for evidence dumps only (never an assertion). */
    errors,
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
      await page.until(
        () => read<boolean>("document.readyState === 'complete'"),
        "page load",
        60_000,
      );
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
    /** Click a grid cell's input: the row whose text has every `row` word, under header `column`. */
    async clickCell(row: string[], column: string) {
      const box = await page.until(
        () =>
          read<{ x: number; y: number } | null>(
            center(`${cellOf(row, column)}?.querySelector("input") ?? ${cellOf(row, column)}`),
          ),
        `cell ${row.join("/")} × ${column}`,
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
    /** Type a value into a grid cell as a person does: click, select all, delete, type, Enter. */
    async setCell(row: string[], column: string, text: string) {
      await page.clickCell(row, column);
      await page.press("a", CTRL);
      await page.press("Delete");
      await page.type(text);
      await page.press("Enter");
    },
    /** What a grid cell renders: its shown value, its inline text, and its drawn marks. */
    readCell: (row: string[], column: string) =>
      read<{
        value: string;
        /** The cell's inline rendered text (innerText; an input's value is not part of it). */
        text: string;
        /** data-staged / data-proposal are hooks on the drawn mark node, not transported data. */
        staged: boolean;
        proposal: boolean;
      } | null>(`(() => {
        const td = ${cellOf(row, column)};
        if (!td) return null;
        const input = td.querySelector("input");
        return {
          value: input ? input.value : td.innerText.trim(),
          text: td.innerText.trim(),
          staged: td.querySelector("[data-staged]") != null,
          proposal: td.querySelector("[data-proposal]") != null,
        };
      })()`),
    /**
     * The proposals band's row for (row, param), as drawn: its whole text, and the text of every
     * part rendered struck through (computed style, what the eye sees). Null when no row is drawn.
     */
    bandRow: (row: string[], param: string) =>
      read<{ text: string; struck: string[] } | null>(`(() => {
        const want = [...${JSON.stringify(row)}, ${JSON.stringify(param)}];
        const band = document.querySelector('section[aria-label="proposals"]');
        const el = band && [...band.children].find((r) => r.getClientRects().length && want.every((w) => (r.firstElementChild?.innerText ?? "").toLowerCase().includes(w.toLowerCase())));
        if (!el) return null;
        const struck = [...el.querySelectorAll("*")]
          .filter((e) => e.childElementCount === 0 && getComputedStyle(e).textDecorationLine.includes("line-through"))
          .map((e) => e.innerText.trim());
        return { text: el.innerText, struck };
      })()`),
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

/**
 * The <td> at (row, column): under the header titled `column`, in the row holding every `row` word.
 * innerText is CSS-transformed (headers render uppercase), so both compare case-insensitively.
 */
const cellOf = (row: string[], column: string) => `(() => {
  const th = [...document.querySelectorAll("thead th")].find((th) => th.getClientRects().length && th.innerText.trim().split(/\\s*\\n/)[0].toLowerCase() === ${JSON.stringify(column.toLowerCase())});
  const grid = th?.closest("table");
  if (!grid) return null;
  const tr = [...grid.querySelectorAll("tbody tr")].find((tr) => ${JSON.stringify(row)}.every((w) => [...tr.children].some((td) => td.innerText.trim().toLowerCase() === w.toLowerCase())));
  if (!tr) return null;
  const h = th.getBoundingClientRect(), x = h.left + h.width / 2;
  return [...tr.children].find((td) => { const r = td.getBoundingClientRect(); return r.left <= x && x <= r.right; }) ?? null;
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
    const message = error instanceof Error ? error.message : String(error);
    // A missing precondition (no slot, no seed, wrong chips) is BLOCKED, never a product FAIL.
    log.push(`RESULT: ${/^(PRECONDITION|BLOCKED):/.test(message) ? "BLOCKED" : "FAIL"} — ${message}`);
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

/**
 * Revit journeys (J1-J4, J6) name their data by env, set by whoever holds the slot:
 * E2E_TARGET (document Address), E2E_ROWS (JSON [[family, type], …]), E2E_PARAM, E2E_VALUE.
 */
export const revit = {
  target: process.env.E2E_TARGET ?? "",
  rows: JSON.parse(process.env.E2E_ROWS ?? "[]") as string[][],
  param: process.env.E2E_PARAM ?? "",
  value: process.env.E2E_VALUE ?? "",
  url: (path: string) => {
    const url = new URL(path, WEB);
    if (process.env.E2E_TARGET) url.searchParams.set("target", process.env.E2E_TARGET);
    return url.href;
  },
};

/**
 * Waits for the route to bind a Revit session. The first paint reads "the bridge is disconnected"
 * even when it is connected, so only a bounded wait without a bound state is a PRECONDITION (no
 * slot). Bound = the LOG's `target session-… › <openId>` line, or the families pane with no
 * disconnected line (the chat plugin pane may not draw the LOG).
 */
export async function requireRevit(page: Page, ms = 60_000) {
  const bound = async () => {
    const text = await page.text();
    return (
      /target session-\S+ › \S+/.test(text) ||
      (/FAMILIES IN SCOPE/i.test(text) && !/BRIDGE IS DISCONNECTED/i.test(text))
    );
  };
  await page.until(bound, "the route to bind a Revit session", ms).catch(() => {
    throw new Error(`PRECONDITION: no Revit bridge after ${ms / 1000}s; this journey runs in the joint-hold slot`);
  });
}

/** A chip's label: the visible combobox named `name` in the composer (Model, Access). */
const chip = (page: Page, name: string) =>
  page.read<string>(
    `[...document.querySelectorAll('[role=combobox][aria-label="${name}"]')].find((e) => e.getClientRects().length)?.innerText.trim() ?? ""`,
  );

/** Before any Pea step (README): an OpenAI model and Trusted access, read off the chips, else BLOCKED. */
export async function requirePea(page: Page) {
  // "model" is the chip's placeholder until the catalog loads.
  const model = await page.until(
    async () => {
      const label = await chip(page, "Model");
      return label && label !== "model" ? label : null;
    },
    "the Model chip to name a model",
    30_000,
  );
  if (!/^(gpt|o\d|codex)/i.test(model))
    throw new Error(`BLOCKED: Chat model is "${model}", not an OpenAI model`);
  const access = await chip(page, "Access");
  if (access !== "Trusted") throw new Error(`BLOCKED: access is "${access}", not "Trusted"`);
}

/**
 * Setup, not an assertion (lead-approved): a new thread starts on Pea's default model, so set the
 * Model chip (E2E_MODEL, default gpt-5.6-terra) and Trusted access through the real pickers.
 * requirePea then reads the chips back from the DOM.
 */
export async function setPea(page: Page, model = process.env.E2E_MODEL ?? "gpt-5.6-terra") {
  await page.until(
    async () => {
      const label = await chip(page, "Model");
      return label && label !== "model";
    },
    "the Model chip to load",
    30_000,
  );
  const pick = async (name: string, option: RegExp, want: string) => {
    if ((await chip(page, name)).startsWith(want)) return;
    await page.clickAt(`[role=combobox][aria-label="${name}"]`);
    await page.click(option);
    await page.until(async () => (await chip(page, name)).startsWith(want), `${name} = ${want}`, 10_000);
  };
  await pick("Model", new RegExp(`^${model.replace(/[.]/g, "\\.")}\\b`), model);
  await pick("Access", /^Trusted\b/, "Trusted");
}

const COMPOSER = 'textarea[aria-label="Message"]';
const CREDIT = /quota|credit|billing|insufficient|rate.?limit|not logged in|not supported|model/i;

/**
 * Send one Chat message as a person does, and wait for the turn to settle. Send is refused
 * while a turn runs (intended), so wait for it, then cancel through the real control. A failed
 * turn whose status names credit or model is BLOCKED with that exact message, not a product fail.
 */
export async function sendChat(page: Page, text: string, ms = 300_000) {
  const working = () =>
    page.read<boolean>(
      `[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "send" && b.title === "Pea is working")`,
    );
  if (await working()) {
    await page
      .until(async () => !(await working()), "the running turn to settle", 60_000)
      .catch(async () => {
        await page.click("cancel");
        await page.until(async () => !(await working()), "cancel to settle", 30_000);
      });
  }
  await page.clickAt(COMPOSER);
  await page.type(text);
  await page.press("Enter");
  await page.waitText(text, 30_000);
  const end = await page.until(
    async () => /\b(READY|FAILED|WAITING FOR YOU)\b/.exec(await page.text())?.[1],
    "the turn to settle",
    ms,
  );
  if (end === "FAILED") {
    const detail = await page.textOf('[data-testid="composer-status-detail"]');
    throw new Error(
      CREDIT.test(detail)
        ? `BLOCKED: ${detail}`
        : `ASSERT the turn completes: FAILED — ${detail || "(no status detail)"}`,
    );
  }
}
