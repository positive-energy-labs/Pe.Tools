import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { connect, CTRL, type Page } from "./cdp.ts";

const SYSTEMS = '[data-list-view][aria-label="systems"]';
const RULINGS = '[data-list-view][aria-label="rulings"]';
const PICTURE = "[data-model-picture]";
const PENDING_PICTURE = `${PICTURE}[data-reading="pending"]`;
const DRAWING =
  '[data-pane-id="e-picture"] canvas[aria-label^="3D model"], [data-pane-id="e-picture"] svg[aria-label="duct tree"]';
const SEARCH = `${RULINGS} input[aria-label="Search rulings"]`;
const ductWrite = (name: string) => /^write(?: [0-9]+)? to Revit$/i.test(name);
const RECONNECT_REFUSALS = [
  "Thread list is not current; reconnecting.",
  "This thread is not current; re-reading it from the host.",
];
type ShiftSource = {
  previousRect: unknown;
  currentRect: unknown;
  node?: { node?: { nodeType?: number } };
  status?: {
    sameParent: boolean;
    entries: { text: string; rect: unknown; at: number }[];
    parent: string;
  };
};
const finiteRect = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  ["x", "y", "width", "height"].every((key) => {
    const coordinate = (value as Record<string, unknown>)[key];
    return typeof coordinate === "number" && Number.isFinite(coordinate);
  });
const fixedStatusText = (source: ShiftSource) => {
  const entries = source.status?.entries ?? [];
  return (
    source.node?.node?.nodeType === 3 &&
    source.status?.sameParent === true &&
    finiteRect(source.previousRect) &&
    finiteRect(source.currentRect) &&
    JSON.stringify(source.previousRect) === JSON.stringify(source.currentRect) &&
    entries.some((entry) => entry.text !== entries[0]?.text) &&
    entries.every(
      (entry) =>
        finiteRect(entry.rect) && JSON.stringify(entry.rect) === JSON.stringify(entries[0]?.rect),
    )
  );
};
const visible = `(e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const literal = JSON.stringify;

/** Read-only locator. All actions below go through CDP Input, Page, Network or Debugger. */
async function box(page: Page, selector: string, name?: string) {
  return page.read<{ x: number; y: number } | null>(`(() => {
    const elements = [...document.querySelectorAll(${literal(selector)})].filter(${visible}).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    const e = elements.find(e => ${name === undefined ? "true" : `[e.getAttribute('aria-label'), e.innerText?.trim()].includes(${literal(name)})`});
    if (!e || e.disabled || e.getAttribute('aria-disabled') === 'true') return null;
    const r = e.getBoundingClientRect();
    const row = ['option', 'treeitem'].includes(e.getAttribute('role'));
    const y = row ? r.top + Math.min(10, r.height / 2) : r.top + r.height / 2;
    for (const ratio of row ? [0.35, 0.5, 0.2, 0.65] : [0.5]) {
      const x = r.left + r.width * ratio;
      const hit = document.elementFromPoint(x, y);
      if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && (hit === e || e.contains(hit)) &&
          (!row || !hit.closest('button, a, input, select, textarea, [role=button]'))) return { x, y };
    }
    return null;
  })()`);
}

async function click(page: Page, selector: string, name?: string) {
  const point = await page.until(
    () => box(page, selector, name),
    `visible enabled ${name ?? selector}`,
  );
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await sleep(180);
  for (const type of ["mousePressed", "mouseReleased"])
    await page.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
const button = (page: Page, name: string, root = "") =>
  click(page, `${root} button, ${root} [role=button]`.trim(), name);
const allSystems = (page: Page) => button(page, "Systems", '[data-pane-id="e-picture"]');

async function history(page: Page, direction: "Back" | "Forward") {
  const before = await page.url();
  if (await box(page, "button", direction)) await button(page, direction);
  else {
    const history = await page.send("Page.getNavigationHistory");
    const entry = history.entries[history.currentIndex + (direction === "Back" ? -1 : 1)];
    if (!entry || new URL(entry.url).origin !== new URL(process.env.E2E_WEB!).origin)
      throw new Error(`PRECONDITION: ${direction} has no journey-owned history entry`);
    await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  }
  await page.until(
    async () => (await page.url()) !== before,
    `${direction} changes browser history`,
  );
}

async function fill(page: Page, selector: string, value: string) {
  await click(page, selector);
  await page.press("a", CTRL);
  await page.press("Backspace");
  await page.type(value);
}

const fieldValue = (page: Page, selector: string) =>
  page.read<string>(
    `[...document.querySelectorAll(${literal(selector)})].find(${visible})?.value ?? ''`,
  );
const visibleText = (page: Page, selector: string) =>
  page.read<string>(
    `[...document.querySelectorAll(${literal(selector)})].find(${visible})?.innerText ?? ''`,
  );
async function showReadout(page: Page) {
  if (
    !(await visibleText(page, "[data-picture-readout]")) &&
    (await box(page, 'button[aria-label="picture readout"]'))
  )
    await click(page, 'button[aria-label="picture readout"]');
  return page.until(
    () => visibleText(page, "[data-picture-readout]"),
    "picture readout visible, including through its folded control",
  );
}
const actionName = (page: Page, word: string) =>
  page.read<string | null>(
    `[...document.querySelectorAll('button')].filter(${visible}).map(e => e.getAttribute('aria-label') || e.innerText.trim()).find(name => new RegExp(${literal(`^${word}(?: [0-9]+)?$`)}).test(name)) ?? null`,
  );

async function stageWork(page: Page, selector: string, value: string) {
  if (!(await box(page, selector)) && (await box(page, 'button[aria-label^="Expand Inputs" i]')))
    await click(page, 'button[aria-label^="Expand Inputs" i]');
  if (!(await box(page, selector)))
    throw new Error("PRECONDITION: disposable Work editor must be visible and enabled");
  await fill(page, selector, value);
  await page.press("Enter");
}

async function state(page: Page) {
  return page.read<{
    url: string;
    pictureTitle: string;
    visibility: string;
    title: string;
    crumb: string;
    selected: string | null;
    focus: {
      tag: string;
      label: string | null;
      id: string;
      value: string | null;
      scroll: number[];
    };
    panes: { id: string; top: number; left: number }[];
    armed: string[];
    alerts: string[];
    loading: boolean;
    refreshing: boolean;
  }>(`(() => {
    const shown = ${visible};
    const active = document.activeElement;
    const scroll = [];
    for (let e = active; e; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth) scroll.push(e.scrollTop, e.scrollLeft);
    }
    return {
      url: location.href, title: document.title,
      visibility: document.visibilityState,
      pictureTitle: [...document.querySelectorAll('[data-pane-id="e-picture"] [data-slot="pane-title"]')].find(shown)?.innerText ?? '',
      crumb: [...document.querySelectorAll('[data-e-crumb], [data-picture-readout]')].filter(shown).map(e => e.innerText).join(' | '),
      selected: [...document.querySelectorAll('[data-crumb-segment="selection"]')].find(shown)?.innerText.trim() || null,
      focus: { tag: active?.tagName, label: active?.getAttribute('aria-label'), id: active?.id ?? '', value: active?.value ?? null, scroll },
      panes: [...document.querySelectorAll('[data-pane-id]')].filter(shown).map(e => {
        const body = e.querySelector('[data-slot="pane-body"]');
        return { id: e.getAttribute('data-pane-id'), top: body?.scrollTop ?? 0, left: body?.scrollLeft ?? 0 };
      }),
      armed: [...document.querySelectorAll('button')].filter(shown).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && /^(apply|write|heal|make fan)\\b/i.test(e.getAttribute('aria-label') || e.innerText.trim())).map(e => e.getAttribute('aria-label') || e.innerText.trim()),
      alerts: [...document.querySelectorAll('[role="alert"]')].filter(shown).map(e => e.innerText),
      loading: ![...document.querySelectorAll(${literal(PICTURE)})].some(shown),
      refreshing: [...document.querySelectorAll(${literal(PENDING_PICTURE)})].some(shown)
    };
  })()`);
}

async function settled(page: Page, allowHeld = false) {
  await page.until(
    async () => {
      const s = await state(page);
      if (s.alerts.length) throw new Error(`Rendered alert: ${s.alerts.join(" | ")}`);
      return !s.loading && (allowHeld || !s.refreshing) && (await page.count(PICTURE)) > 0;
    },
    "loaded duct picture",
    60_000,
  );
}

async function subject(page: Page, system: string | readonly string[], allowHeld = false) {
  const expected = typeof system === "string" ? (system ? [system] : []) : [...system];
  if (!allowHeld && expected.length) await showReadout(page);
  await page.until(
    async () => {
      const current = await state(page);
      const raw = new URL(current.url).searchParams.get("system");
      const named = raw ? raw.split(",").filter(Boolean) : [];
      const crumb = await page.read<string[]>(
        `[...document.querySelectorAll('[data-pane-id="e-picture"] [data-slot="pane-title"] [data-crumb-segment]')].filter(${visible}).map(e => e.innerText.trim())`,
      );
      return (
        JSON.stringify(named) === JSON.stringify(expected) &&
        !current.loading &&
        (allowHeld ||
          JSON.stringify(crumb.slice(0, expected.length ? 2 : 1)) ===
            JSON.stringify(expected.length ? ["Systems", expected.join(" + ")] : ["Systems"]))
      );
    },
    `URL and rendered picture scope agree on ${expected.join(" + ") || "all systems"}`,
    30_000,
  );
  await settled(page, allowHeld);
}

async function rows(page: Page) {
  return page.read<{ key: string; text: string }[]>(
    `[...document.querySelectorAll(${literal(`${SYSTEMS} [role=option][data-key]`)})].filter(${visible}).map(e => ({ key: e.getAttribute('data-key'), text: e.innerText.split('\\n')[0] }))`,
  );
}

/** Save actual DOM nodes as remote references, outside app state. No injected observers or stores. */
async function hold(page: Page, selector: string) {
  const result = await page.send("Runtime.evaluate", {
    expression: `[...document.querySelectorAll(${literal(selector)})].find(${visible})`,
    returnByValue: false,
  });
  if (!result.result.objectId) throw new Error(`PRECONDITION: no visible ${selector} to retain`);
  return result.result.objectId as string;
}

async function retained(page: Page, objectId: string) {
  const result = await page.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration:
      "function() { return this.isConnected && this.getClientRects().length > 0; }",
    returnByValue: true,
  });
  return result.result.value === true;
}

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test("seeded real-user route journey", async () => {
  const seed = Number(process.env.CHAOS_SEED ?? 20261023);
  expect(
    Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff,
    "CHAOS_SEED is uint32",
  ).toBe(true);
  const rng = random(seed);
  const capabilities = ["refresh", "reconnect", "worker", "thread", "arming"];
  const required = new Set((process.env.CHAOS_REQUIRE ?? "").split(",").filter(Boolean));
  for (const capability of required)
    expect([...capabilities, "navigation"], `unknown CHAOS_REQUIRE ${capability}`).toContain(
      capability,
    );
  const lane = process.env.CHAOS_LANE;
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const productCheckout = process.env.CHAOS_PRODUCT_ROOT;
  if (!productCheckout)
    throw new Error("PRECONDITION: CHAOS_PRODUCT_ROOT must name the served source checkout");
  const productSourceCommit = execFileSync("git", ["-C", productCheckout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const productDirty = () =>
    execFileSync("git", ["-C", productCheckout, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
  const dir = resolve(
    root,
    ".artifacts",
    "runs",
    `browser-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-route-chaos`,
    `${seed}-${Date.now()}`,
  );
  mkdirSync(dir, { recursive: true });
  const receipt = {
    seed,
    lane,
    commit,
    checkout: root,
    productCheckout,
    productSourceCommit,
    productDirty: productDirty(),
    observedWebBuilds: [] as string[],
    started: new Date().toISOString(),
    target: process.env.CDP_TARGET,
    port: process.env.CDP_PORT,
    required: [...required],
    continuity: {
      sampleMs: 100,
      scope:
        "sampled DOM/focus/scroll continuity; native layout-shift events, not every-frame proof",
    },
    omitted: capabilities.filter((capability) => !required.has(capability)),
    result: "running",
    steps: [] as {
      step: number;
      name: string;
      status: string;
      before?: unknown;
      after?: unknown;
      error?: string;
    }[],
    coverage: {} as Record<string, string>,
    workerProtocol: [] as unknown[],
    draftCensus: [] as unknown[],
    reconnectAlerts: [] as { at: number; messages: string[] }[],
    reconnectRecovery: undefined as unknown,
    routeReturn: undefined as unknown,
    network: [] as {
      method: string;
      url?: string;
      status?: number;
      stream?: boolean;
      requestId?: string;
      requestMethod?: string;
      leaseThread?: string;
      leaseInput?: unknown;
      leaseAccepted?: unknown;
      observedAt?: number;
      error?: string;
      loaderId?: string;
    }[],
  };
  const save = () => {
    const json = JSON.stringify(receipt, null, 2);
    writeFileSync(join(dir, "receipt.json"), json);
    if (process.env.CHAOS_RESULT_PATH) writeFileSync(process.env.CHAOS_RESULT_PATH, json);
  };
  let page: Page | undefined;
  let current = 0;
  let workerSession: string | undefined;
  const workers = new Map<string, string>();
  const paused = new Set<string>();
  const requests = new Map<string, { method: string; leaseThread?: string }>();
  const finishedRequests = new Set<string>();
  let shifts: number[] = [];
  let shiftEvidence: unknown[] = [];
  let shiftReads: Promise<void>[] = [];
  let shiftContext: string | undefined;
  const checkPage = () => {
    if (!page) throw new Error("CDP page not connected");
    return page;
  };
  const available = (capability: string, present: boolean, reason: string) => {
    receipt.coverage[capability] = present ? "available" : `UNPROVEN: ${reason}`;
    if (!present && receipt.steps.length) receipt.steps.at(-1)!.status = "unavailable";
    if (!present && required.has(capability))
      throw new Error(`PRECONDITION: ${capability}: ${reason}`);
    return present;
  };
  const requested = (capability: string) => {
    if (required.has(capability)) return true;
    receipt.coverage[capability] = "UNPROVEN: omitted from CHAOS_REQUIRE; not executed";
    if (receipt.steps.length) receipt.steps.at(-1)!.status = "omitted";
    return false;
  };
  async function step(name: string, run: () => Promise<void>) {
    const item = {
      step: ++current,
      name,
      status: "running",
    } as (typeof receipt.steps)[number];
    receipt.steps.push(item);
    save();
    console.log(`seed=${seed} step=${current} ${name}`);
    try {
      item.before = page ? await state(page) : undefined;
      await run();
      item.after = page ? await state(page) : undefined;
      if (page) expect((await state(page)).alerts, "no rendered crash alert").toEqual([]);
      if (item.status === "running") item.status = "passed";
    } catch (error) {
      item.status = "failed";
      item.error = String(error);
      throw error;
    } finally {
      save();
    }
  }

  // Poll the held main/picture and focus/scroll on every non-navigation disruption.
  async function untouched(run: () => Promise<void>, reconnecting = false) {
    const p = checkPage();
    const before = await state(p);
    shifts = [];
    shiftEvidence = [];
    shiftReads = [];
    const statusObservation = await p.send("Runtime.evaluate", {
      expression: `(() => {
        const node=[...document.querySelectorAll('section[aria-label="Situation"] p')].find(e=>e.getClientRects().length);
        if(!node)return null;
        const read=()=>({text:node.textContent,rect:node.getBoundingClientRect().toJSON(),at:Date.now()});
        const entries=[read()];
        const observer=new MutationObserver(()=>entries.push(read()));
        observer.observe(node,{subtree:true,childList:true,characterData:true});
        return {node,entries,stop(){observer.disconnect()}};
      })()`,
      returnByValue: false,
    });
    const context = statusObservation.result.objectId as string | undefined;
    shiftContext = context;
    const main = await hold(p, '[data-proto="E2"]');
    const picture = await hold(p, DRAWING);
    const active = (
      await p.send("Runtime.evaluate", {
        expression: "document.activeElement",
        returnByValue: false,
      })
    ).result.objectId as string;
    const ancestorArray = (
      await p.send("Runtime.callFunctionOn", {
        objectId: active,
        returnByValue: false,
        functionDeclaration:
          "function(){const out=[];for(let e=this;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)out.push(e);return out;}",
      })
    ).result.objectId as string;
    const properties = await p.send("Runtime.getProperties", {
      objectId: ancestorArray,
      ownProperties: true,
    });
    const ancestors = properties.result
      .filter((property: { name: string }) => /^[0-9]+$/.test(property.name))
      .map((property: { value: { objectId: string } }) => property.value.objectId) as string[];
    let stopped = false;
    let failure: unknown;
    const monitor = (async () => {
      while (!stopped) {
        try {
          expect(await retained(p, main), "main DOM continuity").toBe(true);
          expect(await retained(p, picture), "canvas/SVG continuity").toBe(true);
          const focusIdentity = await p.send("Runtime.callFunctionOn", {
            objectId: active,
            returnByValue: true,
            functionDeclaration:
              "function(){return this.isConnected && this === document.activeElement;}",
          });
          expect(focusIdentity.result.value, "same activeElement DOM object").toBe(true);
          for (const [index, objectId] of ancestors.entries()) {
            const identity = await p.send("Runtime.callFunctionOn", {
              objectId,
              returnByValue: true,
              arguments: [{ value: index }],
              functionDeclaration:
                "function(index){const out=[];for(let e=document.activeElement;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)out.push(e);return this.isConnected && this === out[index];}",
            });
            expect(identity.result.value, `same scroll ancestor DOM object ${index}`).toBe(true);
          }
          const after = await state(p);
          expect(after.visibility, "measured tab stays visible").toBe("visible");
          expect(after.focus, "untouched focus and its scroll parents").toEqual(before.focus);
          expect(after.panes, "untouched pane scroll").toEqual(before.panes);
          expect(new URL(after.url).searchParams.get("viewport"), "untouched URL pose").toBe(
            new URL(before.url).searchParams.get("viewport"),
          );
          expect(
            after.armed.filter((action) => !before.armed.includes(action)),
            "no stale action rearming",
          ).toEqual([]);
          if (
            reconnecting &&
            JSON.stringify(after.alerts) !==
              JSON.stringify(receipt.reconnectAlerts.at(-1)?.messages)
          )
            receipt.reconnectAlerts.push({ at: Date.now(), messages: after.alerts });
          expect(
            reconnecting
              ? after.alerts.filter((message) => !RECONNECT_REFUSALS.includes(message))
              : after.alerts,
            "no unknown alert during reconnect; no alerts outside reconnect",
          ).toEqual([]);
        } catch (error) {
          failure = error;
          return;
        }
        await sleep(100);
      }
    })();
    try {
      await run();
    } finally {
      stopped = true;
      await monitor;
      await Promise.all(shiftReads);
      if (context)
        await p.send("Runtime.callFunctionOn", {
          objectId: context,
          functionDeclaration: "function(){this.stop()}",
        });
      shiftContext = undefined;
      receipt.coverage[`layout-shifts-step-${current}`] = JSON.stringify(shifts);
      receipt.coverage[`layout-shift-sources-step-${current}`] = JSON.stringify(shiftEvidence);
      await Promise.allSettled(
        [
          ...new Set([
            main,
            picture,
            active,
            ancestorArray,
            ...ancestors,
            ...(context ? [context] : []),
          ]),
        ].map((objectId) => p.send("Runtime.releaseObject", { objectId })),
      );
    }
    if (failure) throw failure;
    expect(
      shifts.filter((value) => value > 0),
      "untouched layout shifts",
    ).toEqual([]);
  }

  try {
    await step("explicit lane and Chrome custody", async () => {
      if (
        !process.env.E2E_WEB ||
        !process.env.CDP_PORT ||
        !process.env.CDP_TARGET ||
        !process.env.CHAOS_REQUIRE ||
        !["demo", "host"].includes(lane ?? "")
      )
        throw new Error(
          "PRECONDITION: E2E_WEB (full /ducts URL), CDP_PORT, CDP_TARGET, CHAOS_LANE=demo|host and explicit CHAOS_REQUIRE are required",
        );
      const url = new URL(process.env.E2E_WEB);
      if (
        url.pathname !== "/ducts" ||
        (lane === "demo"
          ? !["scene", "navigation"].includes(url.searchParams.get("demo") ?? "")
          : url.searchParams.has("demo"))
      )
        throw new Error(
          "PRECONDITION: demo lane needs /ducts?demo=navigation (or scene with two systems); host lane needs /ducts with no demo query",
        );
      page = await connect();
      page.onEvent((event) => {
        if (event.method === "Network.requestWillBeSent") {
          const request = event.params.request;
          for (const [name, value] of Object.entries(request.headers ?? {}))
            if (
              name.toLowerCase() === "x-pe-web-build" &&
              !receipt.observedWebBuilds.includes(String(value))
            )
              receipt.observedWebBuilds.push(String(value));
          let leaseThread: string | undefined;
          let leaseInput: unknown;
          if (new URL(request.url).pathname === "/pe/route-view/ducts" && request.postData) {
            try {
              leaseInput = JSON.parse(request.postData);
              leaseThread = (leaseInput as { thread?: string }).thread;
            } catch {
              /* Not a lease publication. */
            }
          }
          requests.set(event.params.requestId, { method: request.method, leaseThread });
          receipt.network.push({
            method: event.method,
            url: request.url,
            requestId: event.params.requestId,
            requestMethod: request.method,
            loaderId: event.params.loaderId,
            leaseThread,
            leaseInput,
            observedAt: Date.now(),
          });
        }
        if (event.method === "Network.loadingFailed")
          receipt.network.push({
            method: event.method,
            requestId: event.params.requestId,
            error: event.params.errorText,
            observedAt: Date.now(),
          });
        if (event.method === "Network.loadingFinished")
          finishedRequests.add(event.params.requestId);
        if (
          event.method === "PerformanceTimeline.timelineEventAdded" &&
          event.params?.event?.type === "layout-shift"
        ) {
          const details = event.params.event.layoutShiftDetails;
          const context = shiftContext;
          const observedShifts = shifts;
          const evidence = shiftEvidence;
          shiftReads.push(
            (async () => {
              const sources = await Promise.all(
                (details?.sources ?? []).map(async (source: { nodeId?: number }) => {
                  const node = source.nodeId
                    ? await page!
                        .send("DOM.describeNode", { backendNodeId: source.nodeId })
                        .catch(String)
                    : null;
                  let status;
                  if (context && source.nodeId) {
                    const resolved = await page!
                      .send("DOM.resolveNode", { backendNodeId: source.nodeId })
                      .catch(() => undefined);
                    if (resolved?.object?.objectId) {
                      try {
                        const read = await page!.send("Runtime.callFunctionOn", {
                          objectId: context,
                          arguments: [{ objectId: resolved.object.objectId }],
                          returnByValue: true,
                          functionDeclaration:
                            "function(source){return {sameParent:source.parentElement===this.node,entries:this.entries,parent:this.node.outerHTML}}",
                        });
                        status = read.result.value;
                      } finally {
                        await page!.send("Runtime.releaseObject", {
                          objectId: resolved.object.objectId,
                        });
                      }
                    }
                  }
                  return { ...source, node, status };
                }),
              );
              const stationaryStatusText = sources.length > 0 && sources.every(fixedStatusText);
              if (!stationaryStatusText) observedShifts.push(details?.value ?? 0);
              evidence.push({
                eventTime: event.params.event.time,
                deliveredAt: Date.now(),
                classification: stationaryStatusText
                  ? "changed status text within identical bounds"
                  : "untouched geometry",
                ...details,
                sources,
              });
            })(),
          );
        }
        if (
          event.method === "Target.attachedToTarget" &&
          event.params?.targetInfo?.type === "worker"
        )
          workers.set(event.params.sessionId, event.params.targetInfo.url);
        if (event.method === "Target.detachedFromTarget") workers.delete(event.params.sessionId);
        if (event.method === "Debugger.paused" && event.sessionId) {
          paused.add(event.sessionId);
          receipt.workerProtocol.push({
            at: Date.now(),
            event: event.method,
            session: event.sessionId,
            reason: event.params.reason,
            frames: event.params.callFrames.slice(0, 3).map((frame: any) => ({
              functionName: frame.functionName,
              url: frame.url,
              location: frame.location,
            })),
          });
        }
        if (event.method === "Debugger.resumed" && event.sessionId) paused.delete(event.sessionId);
        if (event.method === "Network.responseReceived")
          receipt.network.push({
            method: event.method,
            url: event.params.response.url,
            status: event.params.response.status,
            stream: event.params.response.mimeType === "text/event-stream",
            requestId: event.params.requestId,
            requestMethod: requests.get(event.params.requestId)?.method,
            leaseThread: requests.get(event.params.requestId)?.leaseThread,
            loaderId: event.params.loaderId,
            observedAt: Date.now(),
          });
        if (event.method === "Network.webSocketCreated")
          receipt.network.push({ method: event.method, url: event.params.url });
      });
      await page.send("PerformanceTimeline.enable", { eventTypes: ["layout-shift"] });
      // Page auto-attachment only sees related workers. Never attach to another browser tab's worker.
      await page.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [{ type: "worker" }, { exclude: true }],
      });
      await page.open(url.href);
      if ((await state(page)).visibility !== "visible")
        throw new Error(
          "PRECONDITION: route-chaos needs a visible foreground Chrome tab for measured continuity",
        );
      receipt.coverage.browser = JSON.stringify(await page.send("Browser.getVersion"));
      await settled(page);
      await page.until(
        async () => receipt.observedWebBuilds.length > 0,
        "real host-fetch x-pe-web-build header",
      );
      expect(
        receipt.observedWebBuilds,
        "served web build must match the named source checkout",
      ).toEqual([productSourceCommit.slice(0, 12)]);
      receipt.coverage.provenance = receipt.productDirty
        ? "UNPROVEN: served header matches source HEAD, but working tree is dirty; exact source bytes are unproven"
        : "observed real host-fetch x-pe-web-build matches clean source HEAD";
    });
    const p = checkPage();
    let a = "";
    let b = "";
    await step("discover at least two actual system controls", async () => {
      if (await box(p, '[data-pane-id="e-picture"] button', "Systems")) await allSystems(p);
      if (await box(p, 'button[aria-label="Expand systems"]'))
        await click(p, 'button[aria-label="Expand systems"]');
      const options = await p.until(async () => {
        const found = await rows(p);
        return found.length >= 2 ? found : null;
      }, "two actual system rows after expanding the responsive systems pane");
      const index = Math.floor(rng() * options.length);
      a = options[index]!.key;
      b = options[(index + 1) % options.length]!.key;
      receipt.coverage.systems = JSON.stringify(options);
    });
    await step("search, filter, Escape and clear through real rulings controls", async () => {
      if (await box(p, 'button[aria-label^="Expand Rulings" i]'))
        await click(p, 'button[aria-label^="Expand Rulings" i]');
      const rulingRows = () =>
        p.read<string[]>(
          `[...document.querySelectorAll(${literal(`${RULINGS} [role=option][data-key]`)})].filter(${visible}).map(e => e.getAttribute('data-key'))`,
        );
      const firstRuling = await p.until(async () => (await rulingRows())[0], "actual ruling row");
      await fill(p, SEARCH, "chaos-no-such-system-" + seed);
      await p.until(
        async () => (await rulingRows()).length === 0,
        "search transition excludes all rows",
      );
      await p.press("Escape");
      await p.until(
        async () => (await rulingRows()).includes(firstRuling),
        "Escape clears query and restores rows",
      );
      expect(await fieldValue(p, SEARCH), "Escape clears the typed query").toBe("");
      await fill(p, SEARCH, "chaos-no-such-system-" + seed);
      await p.until(
        async () => (await rulingRows()).length === 0,
        "second query excludes all rows",
      );
      await button(p, "Clear search", RULINGS);
      await p.until(
        async () => (await rulingRows()).includes(firstRuling),
        "cleared search restores the original ruling",
      );
      await button(p, "Filter rulings", RULINGS);
      await click(p, '[aria-label="Search filters"] [data-key="field:kind"]');
      await p.until(
        () => p.count('[aria-label="Filter values"] [role=option]'),
        "ruling-kind filter values",
      );
      await click(p, '[aria-label="Filter values"] [role=option]');
      await p.until(() => p.count(`${RULINGS} [data-list-pill]`), "committed real filter pill");
      await button(p, "Clear search", RULINGS);
      await p.until(
        async () => (await rulingRows()).includes(firstRuling),
        "clearing the filter restores the original ruling",
      );
      await p.press("Escape");
    });
    const pickSystem = async (key: string, allowHeld = false) => {
      if (
        !(await box(p, `${SYSTEMS} [role=option][data-key=${literal(key)}]`)) &&
        (await box(p, 'button[aria-label^="Expand systems" i]'))
      )
        await click(p, 'button[aria-label^="Expand systems" i]');
      const raw = new URL(await p.url()).searchParams.get("system");
      const current = raw ? raw.split(",").filter(Boolean) : [];
      const expected = current.includes(key)
        ? current.filter((name) => name !== key)
        : [...current, key];
      await click(p, `${SYSTEMS} [role=option][data-key=${literal(key)}]`);
      await subject(p, expected, allowHeld);
    };
    await step("all → A; Back → all; Forward → A", async () => {
      await pickSystem(a);
      await history(p, "Back");
      await subject(p, "");
      await history(p, "Forward");
      await subject(p, a);
    });
    await step("open Systems pane; A → B; B → all", async () => {
      // The pane rail reveals the same list without changing the named system.
      if (await box(p, 'button[aria-label^="Expand systems" i]'))
        await click(p, 'button[aria-label^="Expand systems" i]');
      await pickSystem(b);
      await allSystems(p);
      await subject(p, "");
    });
    await step("select a real tree row and retain copied URL through reload", async () => {
      await pickSystem(a);
      if (lane === "demo") {
        // The navigation fixture has real schematic data, but no native Revit meshes.
        await button(p, "schematic", '[data-pane-id="e-picture"]');
        await p.until(() => box(p, DRAWING), "the fixture's actual schematic drawing");
        receipt.coverage.drawing = "schematic; native mesh and 3D camera behavior remain unproven";
      }
      if (!(await box(p, '[data-pane-id="e-sidebar"] [role=treeitem]')))
        await button(p, `Expand ${a}`);
      await click(p, '[data-pane-id="e-sidebar"] [role=treeitem][aria-level="2"][data-key]');
      await p.until(
        async () => !!new URL(await p.url()).searchParams.get("selected"),
        "tree selection published to URL",
      );
      await p.until(async () => !!(await state(p)).selected, "selected subject rendered in crumb");
      await showReadout(p);
      expect(await visibleText(p, '[data-picture-readout="selection"]')).not.toBe("");
      const copied = await p.url();
      const before = await state(p);
      await p.open(copied);
      await settled(p);
      await showReadout(p);
      expect(new URL(await p.url()).searchParams.get("selected")).toBe(
        new URL(copied).searchParams.get("selected"),
      );
      await p.until(
        async () => (await state(p)).crumb === before.crumb,
        "copied URL renders the same selected readout",
      );
      expect((await state(p)).crumb).toBe(before.crumb);
      await p.reload();
      await settled(p);
      await showReadout(p);
      await p.until(
        async () => (await state(p)).crumb === before.crumb,
        "reload renders the same selected readout",
      );
      expect((await state(p)).crumb).toBe(before.crumb);
      expect(new URL(await p.url()).searchParams.get("system")).toBe(a);
      // The crumb is a label; the subject picker focuses the same selected element through real controls.
      const selectedId: unknown = JSON.parse(
        new URL(copied).searchParams.get("selected") ?? "null",
      );
      if (typeof selectedId !== "string")
        throw Error("copied selection must be a string element id");
      expect(selectedId, "copied selection is one positive element id").toMatch(/^[1-9]\d*$/);
      await button(p, "go to a subject", '[data-pane-id="e-picture"]');
      await fill(p, 'input[aria-label="go to a subject search"]', selectedId);
      await click(
        p,
        `[aria-label="go to a subject"] [role=option][data-key=${literal(`e${selectedId}`)}]`,
      );
      const pickerState = () =>
        p.read<{ expanded: string | null; visible: boolean; focus: string }>(`(() => {
          const trigger = document.querySelector('[data-pane-id="e-picture"] button[aria-label="go to a subject"]');
          const input = document.querySelector('input[aria-label="go to a subject search"]');
          return { expanded: trigger?.getAttribute('aria-expanded') ?? null,
            visible: !!input?.getClientRects().length,
            focus: document.activeElement?.outerHTML.slice(0, 500) ?? '' };
        })()`);
      const pickerSamples = [{ phase: "after subject pick", ...(await pickerState()) }];
      receipt.coverage.selectionPicker = JSON.stringify(pickerSamples);
      save();
      if (pickerSamples[0]!.expanded === "true")
        await button(p, "go to a subject", '[data-pane-id="e-picture"]');
      await p.until(async () => {
        const state = await pickerState();
        return state.expanded === "false" && !state.visible;
      }, "subject picker is closed before selection Escape");
      pickerSamples.push({ phase: "after picker closed", ...(await pickerState()) });
      expect(
        new URL(await p.url()).searchParams.get("selected"),
        "selection is armed before Escape",
      ).toBe(new URL(copied).searchParams.get("selected"));
      await sleep(350);
      const escapePose = new URL(await p.url()).searchParams.get("viewport");
      pickerSamples.push({ phase: "before original selection Escape", ...(await pickerState()) });
      receipt.coverage.selectionPicker = JSON.stringify(pickerSamples);
      save();
      await p.press("Escape");
      await p.until(
        async () => !new URL(await p.url()).searchParams.get("selected"),
        "Escape clears the selected element",
      );
      await sleep(200);
      expect(new URL(await p.url()).searchParams.get("viewport"), "Escape preserves pose").toBe(
        escapePose,
      );
    });

    await step("quiet 36s watchdog dwell with accepted route lease and world SSE", async () => {
      await settled(p);
      const thread = new URL(await p.url()).searchParams.get("thread");
      const loaderId = (await p.send("Page.getFrameTree")).frameTree.frame.loaderId;
      if (!thread) throw new Error("PRECONDITION: quiet watchdog needs an addressed URL thread");
      const lease = await p.until(
        async () =>
          [...receipt.network]
            .reverse()
            .find(
              (event) =>
                event.url &&
                new URL(event.url).pathname === "/pe/route-view/ducts" &&
                event.leaseThread === thread &&
                event.loaderId === loaderId &&
                event.status === 200 &&
                event.requestId &&
                finishedRequests.has(event.requestId),
            ),
        "accepted Ducts lease response for this thread",
        15_000,
      );
      const body = await p.send("Network.getResponseBody", { requestId: lease.requestId });
      const accepted = JSON.parse(
        body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body,
      );
      if (typeof accepted.revision !== "number")
        throw new Error("PRECONDITION: route lease response has no accepted revision");
      const world = await p.until(
        async () =>
          receipt.network.find((event) => {
            if (!event.stream || !event.url || event.loaderId !== loaderId) return false;
            try {
              return JSON.parse(new URL(event.url).searchParams.get("keys") ?? "[]").some(
                (key: { kind?: string }) => key.kind === "world",
              );
            } catch {
              return false;
            }
          }),
        "observed world SSE subscription URL",
        15_000,
      );
      const counts = () => ({
        sseResponses: receipt.network.filter((e) => e.stream && e.loaderId === loaderId).length,
        routeRequests: receipt.network.filter(
          (e) =>
            e.method === "Network.requestWillBeSent" &&
            e.loaderId === loaderId &&
            e.url &&
            new URL(e.url).pathname === "/pe/route-view/ducts",
        ).length,
        routePublications: receipt.network.filter(
          (e) =>
            e.method === "Network.responseReceived" &&
            e.loaderId === loaderId &&
            e.url &&
            new URL(e.url).pathname === "/pe/route-view/ducts" &&
            e.status === 200 &&
            e.requestMethod === "PUT",
        ).length,
      });
      // Initial acquisitions settle before the witness. Identical five-second lease PUTs
      // renew seen-time without changing revision (RouteViewStore.publish); SSE must stay quiet.
      let baseline = counts();
      let stableSince = Date.now();
      await p.until(
        async () => {
          const now = counts();
          if (JSON.stringify(now) !== JSON.stringify(baseline)) {
            baseline = now;
            stableSince = Date.now();
          }
          return (
            Date.now() - stableSince >= 2000 &&
            receipt.network
              .filter(
                (e) =>
                  e.method === "Network.requestWillBeSent" &&
                  e.loaderId === loaderId &&
                  e.url &&
                  new URL(e.url).pathname === "/pe/route-view/ducts",
              )
              .every((e) => !!e.requestId && finishedRequests.has(e.requestId))
          );
        },
        "initial world/route acquisition quiescence",
        15_000,
      );
      const latestLease = [...receipt.network]
        .reverse()
        .find(
          (e) =>
            e.loaderId === loaderId &&
            e.requestMethod === "PUT" &&
            e.status === 200 &&
            e.leaseThread === thread &&
            e.requestId &&
            finishedRequests.has(e.requestId) &&
            e.url &&
            new URL(e.url).pathname === "/pe/route-view/ducts",
        )!;
      const baselineRequest = receipt.network.find(
        (e) => e.method === "Network.requestWillBeSent" && e.requestId === latestLease.requestId,
      );
      if (!baselineRequest?.leaseInput)
        throw new Error("PRECONDITION: accepted lease PUT input is absent from CDP");
      const acceptedBody = async (requestId: string) => {
        const response = await p.send("Network.getResponseBody", { requestId });
        return JSON.parse(
          response.base64Encoded
            ? Buffer.from(response.body, "base64").toString("utf8")
            : response.body,
        );
      };
      const baselineAccepted = await acceptedBody(latestLease.requestId!);
      latestLease.leaseAccepted = baselineAccepted;
      const { revision, ...baselineView } = baselineAccepted;
      expect(baselineView, "accepted lease echoes the actual PUT view").toEqual(
        baselineRequest.leaseInput,
      );
      expect(typeof revision).toBe("number");
      const startIndex = receipt.network.length;
      const checked = new Set<string>();
      const renewals: {
        requestId: string;
        observedAt?: number;
        instance: string;
        revision: number;
        identicalView: boolean;
      }[] = [];
      let lastAccepted = latestLease.observedAt!;
      const inspectQuiet = async () => {
        expect(
          counts().sseResponses,
          "quiet watchdog: SSE response identity remains continuous; no reacquisition",
        ).toBe(baseline.sseResponses);
        const traffic = receipt.network.slice(startIndex);
        const puts = traffic.filter(
          (e) =>
            e.method === "Network.requestWillBeSent" &&
            e.loaderId === loaderId &&
            e.url &&
            new URL(e.url).pathname.startsWith("/pe/route-view/ducts"),
        );
        for (const request of puts) {
          expect(
            request.requestMethod,
            "quiet lease identity: only identical PUT renewals, never remove/DELETE or commands",
          ).toBe("PUT");
          expect(
            new URL(request.url!).pathname,
            "quiet lease identity: same publication endpoint",
          ).toBe("/pe/route-view/ducts");
          expect(
            request.leaseInput,
            "quiet lease identity: same instance and identical complete view input",
          ).toEqual(baselineRequest.leaseInput);
          expect(
            traffic.find(
              (e) => e.method === "Network.loadingFailed" && e.requestId === request.requestId,
            ),
            "quiet lease renewal transport remains acquired",
          ).toBeUndefined();
          const response = traffic.find(
            (e) => e.method === "Network.responseReceived" && e.requestId === request.requestId,
          );
          if (response) expect(response.status, "quiet lease renewal accepted").toBe(200);
          if (
            !response ||
            !finishedRequests.has(request.requestId!) ||
            checked.has(request.requestId!)
          )
            continue;
          const renewed = await acceptedBody(request.requestId!);
          response.leaseAccepted = renewed;
          const { revision: nextRevision, ...view } = renewed;
          expect(view, "quiet lease identity: accepted view remains identical").toEqual(
            baselineView,
          );
          expect(
            nextRevision,
            "quiet lease identity: no-op renewal preserves accepted revision",
          ).toBe(revision);
          expect(
            response.observedAt! - lastAccepted,
            "quiet lease identity: accepted renewals never cross host expiry",
          ).toBeLessThan(15_000);
          lastAccepted = response.observedAt!;
          checked.add(request.requestId!);
          renewals.push({
            requestId: request.requestId!,
            observedAt: response.observedAt,
            instance: view.instance,
            revision: nextRevision,
            identicalView: true,
          });
          receipt.coverage.watchdog = JSON.stringify({
            ...JSON.parse(receipt.coverage.watchdog),
            renewals,
          });
        }
        expect(
          Date.now() - lastAccepted,
          "quiet lease identity: accepted lease never expires/reacquires (host MAX_AGE_MS)",
        ).toBeLessThan(15_000);
        return puts.every((e) => checked.has(e.requestId!));
      };
      receipt.coverage.watchdog = JSON.stringify({
        dwellMs: 36_000,
        leaseUrl: lease.url,
        revision,
        instance: baselineView.instance,
        viewInput: baselineRequest.leaseInput,
        renewals,
        worldStreamUrl: world.url,
        sampledEveryMs: 100,
        baseline,
        redControl: process.env.CHAOS_WATCHDOG_RED ?? null,
      });
      await untouched(async () => {
        const red = process.env.CHAOS_WATCHDOG_RED;
        if (red) {
          if (red !== "disconnect")
            throw new Error("Unknown CHAOS_WATCHDOG_RED; expected disconnect");
          await p.send("Network.emulateNetworkConditions", {
            offline: true,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          });
          await sleep(1000);
          await p.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          });
        }
        const end = Date.now() + 36_000;
        while (Date.now() < end) {
          await sleep(100);
          await inspectQuiet();
        }
        await p.until(
          inspectQuiet,
          "all observed quiet renewals accepted with unchanged identity/revision",
          15_000,
        );
        if (red)
          throw new Error(
            "RED CONTROL INEFFECTIVE: transport disruption did not violate SSE/lease identity",
          );
        await settled(p);
      });
      receipt.coverage.watchdog = JSON.stringify({
        ...JSON.parse(receipt.coverage.watchdog),
        final: counts(),
        result:
          "36s sampled DOM continuity, stable SSE, identical-view same-revision lease renewals passed",
      });
    });

    const disruptions = rng() < 0.5 ? ["refresh", "reconnect"] : ["reconnect", "refresh"];
    for (const disruption of disruptions)
      await step(`untouched ${disruption}`, async () => {
        if (!requested(disruption)) return;
        if (disruption === "reconnect") {
          const streams = receipt.network.filter((event) => event.stream).length;
          await untouched(async () => {
            await p.send("Network.emulateNetworkConditions", {
              offline: true,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
            });
            await sleep(500 + Math.floor(rng() * 1000));
            await p.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
            });
            if (streams)
              await p.until(
                async () => receipt.network.filter((event) => event.stream).length > streams,
                "new SSE response after reconnect",
                15_000,
              );
            else await sleep(500);
            await settled(p);
            receipt.reconnectRecovery = {
              at: Date.now(),
              alerts: (await state(p)).alerts,
              newSseResponses: receipt.network.filter((event) => event.stream).length - streams,
              status: "alerts cleared after online; continuity and geometry checked separately",
            };
          }, true);
          available(
            "reconnect",
            receipt.network.filter((event) => event.stream).length > streams,
            "offline/online ran, but no new SSE response was observed; this lane cannot prove stream reconnect",
          );
          if (receipt.network.filter((event) => event.stream).length > streams)
            receipt.coverage.reconnect =
              "new SSE response observed after CDP offline/online; DOM continuity retained";
        } else {
          if (!(await box(p, "button", "refresh")) && (await box(p, "button", "Show Situation")))
            await button(p, "Show Situation");
          if (
            !available(
              "refresh",
              !!(await box(p, "button", "refresh")),
              "no enabled refresh control; bind a real document for host lane",
            )
          )
            return;
          // Deliberate focus move happens before the untouched observation window.
          const point = await p.until(() => box(p, "button", "refresh"), "refresh control");
          const trigger = (
            await p.send("Runtime.evaluate", {
              expression: `document.elementFromPoint(${point.x}, ${point.y})?.closest('button')`,
              returnByValue: false,
            })
          ).result.objectId as string;
          const focusCensus: unknown[] = [];
          const census = async (phase: string) => {
            const evidence = await p.send("Runtime.callFunctionOn", {
              objectId: trigger,
              returnByValue: true,
              functionDeclaration: `function(){
                const active=document.activeElement;
                const scroll=[];
                for(let e=active;e;e=e.parentElement)if(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)scroll.push({tag:e.tagName,id:e.id,slot:e.getAttribute('data-slot'),top:e.scrollTop,left:e.scrollLeft});
                return {triggerConnected:this.isConnected,triggerActive:this===active,triggerDisabled:this.disabled,triggerAriaDisabled:this.getAttribute('aria-disabled'),trigger:this.outerHTML,active:active?.outerHTML.slice(0,1600),scroll};
              }`,
            });
            focusCensus.push({ phase, ...evidence.result.value });
            receipt.coverage.refreshFocus = JSON.stringify(focusCensus);
            save();
          };
          await census("before trusted press");
          await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
          await p.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            ...point,
            button: "left",
            clickCount: 1,
          });
          await census("after trusted press, before release");
          // Mousedown puts focus on the control. Observe before mouseup admits the refresh.
          try {
            await untouched(async () => {
              await p.send("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                ...point,
                button: "left",
                clickCount: 1,
              });
              await census("after trusted release");
              await sleep(350);
              await settled(p);
              await census("after re-read settled");
            });
            expect(
              await p.read<boolean>(
                `[...document.querySelectorAll('[data-slot="popover-content"]')].some(e => e.getClientRects().length && e.textContent.includes('refresh · ran'))`,
              ),
              "status flag is still open before the deliberate editor focus move",
            ).toBe(true);
            await click(p, 'textarea[aria-label="Message"]');
            const statusOpenAfterEditor = await p.read<boolean>(
              `[...document.querySelectorAll('[data-slot="popover-content"]')].some(e => e.getClientRects().length && e.textContent.includes('refresh · ran'))`,
            );
            receipt.coverage.refreshStatusClose = JSON.stringify({
              statusOpenAfterEditor,
              observeMs: 5200,
              reason: statusOpenAfterEditor
                ? "natural fade remains pending"
                : "deliberate editor gesture dismissed status before its fade",
            });
            await census("deliberately focused Message before original fade deadline");
            await untouched(async () => {
              const deadline = Date.now() + 5200;
              await p.until(
                () =>
                  p.read<boolean>(
                    `![...document.querySelectorAll('[data-slot="popover-content"]')].some(e => e.getClientRects().length && e.textContent.includes('refresh · ran'))`,
                  ),
                "Refresh status flag closed",
              );
              await sleep(Math.max(0, deadline - Date.now()));
              await census("after status closure and original fade interval with Message retained");
            });
          } finally {
            await p.send("Runtime.releaseObject", { objectId: trigger });
          }
          receipt.coverage.refresh =
            "trusted Refresh retained trigger focus and DOM continuity; deliberately focused Message then status closure/original fade interval retained that editor/scroll-parent identity; host freshness requires native receipt in parent run";
        }
      });
    await step(
      "worker paused in flight; old completion cannot replace current system",
      async () => {
        if (!requested("worker")) return;
        const worker = [...workers].find(([, url]) => /pricing\.worker/.test(url));
        if (
          !available(
            "worker",
            !!worker && !!(await box(p, "button", "refresh")),
            "pricing worker and enabled refresh are required on this target",
          )
        )
          return;
        workerSession = worker![0];
        const oldDrawing = await hold(p, DRAWING);
        const oldIdentity = (await state(p)).pictureTitle;
        expect(oldIdentity, "old picture names its subject before pausing").not.toBe("");
        // The route's public busy ancestor owns snapshot freshness and held pricing (route.tsx).
        const routeBusy = () =>
          p.read<{ value: string | null; owner: string | null }>(`(() => {
            const pane = document.querySelector('[data-pane-id="e-picture"]');
            const owner = pane?.closest('[aria-busy]');
            return { value: owner?.getAttribute('aria-busy') ?? null,
              owner: owner ? owner.outerHTML.slice(0, owner.outerHTML.indexOf('>') + 1) : null };
          })()`);
        const sampleBusy = async (phase: string) => {
          const sample = await routeBusy();
          receipt.workerProtocol.push({ at: Date.now(), phase, ...sample });
          save();
          return sample.value;
        };
        expect(await sampleBusy("before worker pause"), "settled route is not busy").toBe("false");
        await p.send("Debugger.enable", {}, workerSession);
        await p.send("Debugger.pause", {}, workerSession);
        receipt.workerProtocol.push({
          at: Date.now(),
          command: "Debugger.pause returned",
          session: workerSession,
          workerUrl: worker![1],
          paused: paused.has(workerSession),
        });
        try {
          // An idle worker may not enter JS until the trusted Refresh posts its next job.
          await button(p, "refresh");
          receipt.workerProtocol.push({ at: Date.now(), command: "trusted Refresh released" });
          await p.until(async () => paused.has(workerSession!), "pricing worker actually paused");
          await p.until(
            () =>
              p.read<boolean>(
                `[...document.querySelectorAll(${literal(PENDING_PICTURE)})].some(${visible})`,
              ),
            "visible picture is pending while worker is paused",
          );
          expect(await sampleBusy("worker paused after trusted Refresh")).toBe("true");
          expect(
            await retained(p, oldDrawing),
            "old drawing remains connected while pricing is paused",
          ).toBe(true);
          expect(
            (await state(p)).pictureTitle,
            "old picture subject remains drawn before changing system",
          ).toBe(oldIdentity);
          receipt.workerProtocol.push({
            at: Date.now(),
            heldOldIdentity: oldIdentity,
            paused: paused.has(workerSession),
          });
          save();
          if (
            lane === "host" &&
            process.env.CHAOS_STAGE_SELECTOR &&
            process.env.CHAOS_STAGE_VALUE !== undefined
          ) {
            await stageWork(p, process.env.CHAOS_STAGE_SELECTOR, process.env.CHAOS_STAGE_VALUE);
            receipt.coverage.workerWork = "changed a real Work editor while old pricing was paused";
          }
          await allSystems(p);
          await subject(p, "", true);
          await pickSystem(b, true);
        } finally {
          await p.send("Debugger.resume", {}, workerSession);
          await p.send("Runtime.releaseObject", { objectId: oldDrawing });
        }
        await p.until(
          async () => (await routeBusy()).value === "false",
          "public route busy clears after worker resume",
        );
        expect(await sampleBusy("after worker resume")).toBe("false");
        await settled(p);
        await subject(p, b);
        const freshReadout = await showReadout(p);
        const copied = await p.url();
        await p.open(copied);
        await settled(p);
        await showReadout(p);
        await p.until(
          async () => (await visibleText(p, "[data-picture-readout]")) === freshReadout,
          "fresh URL renders the same completed worker readout",
        );
        expect(
          await visibleText(p, "[data-picture-readout]"),
          "late worker delivery agrees with a fresh URL load of persisted Work",
        ).toBe(freshReadout);
        receipt.coverage.worker =
          "pricing worker paused during refresh; changed system before completion; final readout agrees with fresh URL load";
      },
    );
    await step("route leave/return; Pea draft identity through thread leave/return", async () => {
      const route = await p.url();
      const routeThread = new URL(route).searchParams.get("thread");
      const baselineReadout = await showReadout(p);
      const baseline = await state(p);
      expect(baseline.pictureTitle, "Ducts baseline has a rendered title").not.toBe("");
      expect(baselineReadout, "Ducts baseline has a rendered readout").not.toBe("");
      const main = await hold(p, '[data-proto="E2"]');
      await button(p, "Open Pea");
      await p.until(async () => new URL(await p.url()).pathname === "/pea", "Pea route");
      const enteredPeaThread = new URL(await p.url()).searchParams.get("thread");
      const composer = 'textarea[aria-label="Message"]';
      await p.until(() => box(p, composer), "Pea composer", 30_000);
      expect(
        await p.read<number>(
          `[...document.querySelectorAll(${literal(composer)})].filter(${visible}).length`,
        ),
        "one visible Pea composer",
      ).toBe(1);
      const draftReference = (
        await p.send("Runtime.evaluate", {
          expression: `(() => {
          const node = [...document.querySelectorAll(${literal(composer)})].find(${visible});
          let scroll = node;
          while (scroll && scroll.scrollHeight <= scroll.clientHeight && scroll.scrollWidth <= scroll.clientWidth) scroll = scroll.parentElement;
          return { node, scroll };
        })()`,
          returnByValue: false,
        })
      ).result.objectId as string;
      const censusDraft = async (phase: string) => {
        const result = await p.send("Runtime.callFunctionOn", {
          objectId: draftReference,
          returnByValue: true,
          functionDeclaration: `function() {
            const shown = ${visible};
            const nodes = [...document.querySelectorAll(${literal(composer)})].filter(shown);
            const current = nodes[0];
            let scroll = current;
            while (scroll && scroll.scrollHeight <= scroll.clientHeight && scroll.scrollWidth <= scroll.clientWidth) scroll = scroll.parentElement;
            const describe = node => node ? { value: node.value, aria: node.getAttribute('aria-label'), active: node === document.activeElement, connected: node.isConnected, visible: shown(node), top: node.scrollTop, left: node.scrollLeft, html: node.outerHTML } : null;
            return { url: location.href, thread: new URL(location.href).searchParams.get('thread'), prompt: new URL(location.href).searchParams.get('prompt'), visibleCount: nodes.length, sameNode: current === this.node, retained: describe(this.node), current: describe(current), sameScrollParent: scroll === this.scroll, retainedScrollParent: describe(this.scroll), scrollParent: describe(scroll), transcriptBusy: [...document.querySelectorAll('[data-chat-transcript]')].filter(shown).map(e => e.getAttribute('aria-busy')), firstOpenVisible: [...document.querySelectorAll('section[aria-label="set up Pea"]')].some(shown), alerts: [...document.querySelectorAll('[role="alert"]')].filter(shown).map(e => e.innerText) };
          }`,
        });
        const evidence = result.result.value;
        receipt.draftCensus.push({ at: Date.now(), phase, reference: draftReference, ...evidence });
        save();
        return evidence;
      };
      await censusDraft("initial visible Pea composer; first-open surface observed");
      if (required.has("thread") && (await box(p, 'button[aria-label="Expand threads"]')))
        await click(p, 'button[aria-label="Expand threads"]');
      const threads = await p.read<string[]>(
        `[...document.querySelectorAll('[data-list-view][aria-label="threads"] [role=option][data-key]')].filter(${visible}).map(e => e.getAttribute('data-key'))`,
      );
      const canSwitch =
        required.has("thread") &&
        available(
          "thread",
          threads.length >= 2,
          "two existing visible disposable threads are required for thread identity proof",
        );
      if (!required.has("thread"))
        receipt.coverage.thread =
          "UNPROVEN: omitted from CHAOS_REQUIRE; existing-thread switches not executed";
      const pickThread = async (id: string) => {
        if (await box(p, 'button[aria-label="Expand threads"]'))
          await click(p, 'button[aria-label="Expand threads"]');
        await click(
          p,
          `[data-list-view][aria-label="threads"] [role=option][data-key=${literal(id)}]`,
        );
        await p.until(
          async () =>
            new URL(await p.url()).searchParams.get("thread") === id &&
            (await p.count('[data-chat-transcript][aria-busy="true"]')) === 0,
          `thread ${id} loaded`,
        );
      };
      if (canSwitch) await pickThread(threads[0]!);
      const transcript = await visibleText(p, "[data-chat-transcript]");
      const marker = `unsent route-chaos ${seed}`;
      const draftBefore = await fieldValue(p, composer);
      if (draftBefore)
        throw new Error("PRECONDITION: Pea composer must be empty in disposable browser profile");
      await fill(p, composer, marker);
      const typed = await censusDraft("immediately after trusted fill");
      expect(typed.visibleCount, "trusted typing targets one visible composer").toBe(1);
      expect(typed.current?.value, "trusted typing produced the draft before leaving Pea").toBe(
        marker,
      );
      if (canSwitch) {
        await pickThread(threads[1]!);
        expect(await fieldValue(p, composer), "A's draft never appears in B").not.toBe(marker);
        await pickThread(threads[0]!);
        expect(await fieldValue(p, composer), "A's draft returns to A").toBe(marker);
        expect(await visibleText(p, "[data-chat-transcript]"), "A's transcript returns to A").toBe(
          transcript,
        );
      }
      const pea = await p.url();
      const peaThread = new URL(pea).searchParams.get("thread");
      await censusDraft("before Home");
      await button(p, "Home / tool directory");
      await censusDraft("after Home; retained composer may be hidden");
      await history(p, "Back");
      await censusDraft("after Back before composer/thread settle");
      await p.until(() => box(p, composer), "composer on return");
      await censusDraft("visible composer on return before URL/thread settle");
      await p.until(
        async () =>
          (await p.url()) === pea &&
          (await p.read<boolean>(
            `[...document.querySelectorAll('[data-chat-transcript]')].filter(${visible}).every(e => e.getAttribute('aria-busy') !== 'true')`,
          )),
        "returned Pea URL and visible thread settled",
      );
      await censusDraft("after URL/thread settle; first-open surface observed");
      expect(await p.url()).toBe(pea);
      expect(await fieldValue(p, composer)).toBe(marker);
      await fill(p, composer, "");
      for (let back = 0; back < 6 && new URL(await p.url()).pathname !== "/ducts"; back++) {
        await history(p, "Back");
        await sleep(150);
      }
      await settled(p);
      expect(await p.url()).toBe(route);
      await showReadout(p);
      await p.until(
        async () => (await state(p)).crumb === baseline.crumb,
        "returned route renders its original picture readout",
      );
      const restored = await state(p);
      const restoredReadout = await visibleText(p, "[data-picture-readout]");
      const mainRetained = await retained(p, main);
      // Browser Place identity retains the body across conversation changes as well as route visits.
      const sameThread =
        routeThread === enteredPeaThread && routeThread === peaThread && !canSwitch;
      receipt.routeReturn = {
        routeThread,
        enteredPeaThread,
        peaThread,
        threadSwitchExercised: canSwitch,
        sameThread,
        originalMainRetained: mainRetained,
        baseline: { ...baseline, readout: baselineReadout },
        restored: { ...restored, readout: restoredReadout },
      };
      save();
      expect(
        mainRetained,
        "browser Place Activity retained the Ducts main DOM across conversations",
      ).toBe(true);
      expect(restored.pictureTitle, "returned picture title").toBe(baseline.pictureTitle);
      expect(restored.crumb, "returned picture identity").toBe(baseline.crumb);
      expect(restoredReadout, "returned picture readout").toBe(baselineReadout);
      expect(restored.selected, "returned selection").toBe(baseline.selected);
      expect(new URL(restored.url).searchParams.get("viewport"), "returned URL pose").toBe(
        new URL(route).searchParams.get("viewport"),
      );
      expect(
        await p.read<boolean>(
          `[...document.querySelectorAll(${literal(DRAWING)})].some(${visible})`,
        ),
        "returned drawing is visible",
      ).toBe(true);
      expect(restored.alerts, "returned route has no alerts").toEqual([]);
      expect(restored.loading || restored.refreshing, "returned route is settled").toBe(false);
      expect(
        restored.armed.filter((action) => !baseline.armed.includes(action)),
        "route return cannot rearm stale actions",
      ).toEqual([]);
      await p.send("Runtime.releaseObject", { objectId: main });
      await p.send("Runtime.releaseObject", { objectId: draftReference });
      receipt.coverage.draft = "unsent draft survives route leave/return";
      if (canSwitch)
        receipt.coverage.thread =
          "A→B→A keeps distinct draft and transcript; route leave/return keeps A's draft";
    });
    await step("staged Work preview loses authority after refresh and route return", async () => {
      if (!requested("arming")) return;
      const editor = process.env.CHAOS_STAGE_SELECTOR;
      const stageValue = process.env.CHAOS_STAGE_VALUE;
      if (
        !available(
          "arming",
          lane === "host" && !!editor && stageValue !== undefined,
          "host lane needs a disposable Work editor CHAOS_STAGE_SELECTOR and CHAOS_STAGE_VALUE; staging persists Work, preview asks native Revit, Apply is never pressed",
        )
      )
        return;
      await pickSystem(a);
      if (!(await box(p, "button", "refresh")) && (await box(p, "button", "Show Situation")))
        await button(p, "Show Situation");
      await stageWork(p, editor!, stageValue!);
      const preview = await p.until(
        async () => {
          const name = await actionName(p, "preview");
          return name && (await box(p, "button", name)) ? name : null;
        },
        "persisted staged Work exposes an enabled Preview",
        30_000,
      );
      await button(p, preview);
      await p.until(
        async () => (await state(p)).armed.some(ductWrite),
        "native Preview arms the Ducts Write control",
        60_000,
      );
      await p.press("Escape");
      await button(p, "refresh");
      await settled(p);
      await p.until(
        async () => !(await state(p)).armed.some(ductWrite),
        "refresh disarms stale Ducts Write",
      );
      await button(p, "Open Pea");
      await history(p, "Back");
      await settled(p);
      expect(
        (await state(p)).armed.filter(ductWrite),
        "route return cannot rearm stale Ducts Write",
      ).toEqual([]);
      receipt.coverage.arming =
        "persisted a real Work cell via UI; native Preview armed Write; refresh and route return disarmed Write. Native write consumption remains UNPROVEN";
    });
    expect(p.errors, "no uncaught browser exceptions").toEqual([]);
    expect(receipt.observedWebBuilds, "served build remains the named source build").toEqual([
      productSourceCommit.slice(0, 12),
    ]);
    expect(productDirty(), "served source tree did not change during the run").toBe(
      receipt.productDirty,
    );
    expect(
      execFileSync("git", ["-C", productCheckout, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      "served source HEAD did not change during the run",
    ).toBe(productSourceCommit);
    receipt.result =
      receipt.productDirty ||
      receipt.omitted.length ||
      receipt.steps.some((item) => item.status === "unavailable")
        ? "partial"
        : "passed";
    await p.dump(dir, "final");
  } catch (error) {
    receipt.result = "failed";
    if (page)
      await page.dump(dir, `seed-${seed}-step-${current}-failed`).catch((dumpError) => {
        receipt.coverage.failureArtifact = `UNPROVEN: ${String(dumpError)}`;
      });
    throw error;
  } finally {
    if (page) {
      await page
        .send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
        .catch(() => undefined);
      if (workerSession) {
        await page.send("Debugger.resume", {}, workerSession).catch(() => undefined);
        await page
          .send("Target.detachFromTarget", { sessionId: workerSession })
          .catch(() => undefined);
      }
      receipt.coverage.exceptions = JSON.stringify(page.errors);
      await page.close();
    }
    save();
    console.log(`route-chaos ${receipt.result}: ${dir}`);
  }
});
