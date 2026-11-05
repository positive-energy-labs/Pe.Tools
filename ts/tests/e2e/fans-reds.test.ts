// Two real-Revit witnesses for /fans (Driver walk on e6069eb6, Chadds). Both start RED.
// No-Revit /fans?demo=navigation draws only "Choose a document", so neither runs on the owned fixture.
// Run: PE_TOOLS_PRODUCT_HOME=<drive home> route-chaos-launch.ts --suite fans --revit --source <checkout>;
// once its host holds the service claim, start a controlled Revit from the same checkout with the
// same PE_TOOLS_PRODUCT_HOME and open a Chadds copy. Pe.App then joins that host.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { workEvidence } from "./conversation-work.fixture.ts";
import { connectTypedPage, type TypedPage } from "./typed-page.ts";

const FANS_PANES = ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"];
// Rulings (e-inbox) folds to a rail at the 1600 px owned viewport; case 2 unfolds it.
const DUCTS_PANES = ["e-systems", "e-picture"];
const MALFORMED = /Malformed route value/;
const out = () => dirname(process.env.E2E_RESULT_PATH!);

/** The first visible control in `scope` whose text matches `pattern`, with its press point. */
function find(page: TypedPage, scope: string, pattern: string) {
  return page.evaluate(
    (scope, pattern) => {
      const re = new RegExp(pattern, "i");
      const name = (e: HTMLElement) =>
        (e.innerText ?? "").trim() || e.getAttribute("aria-label") || "";
      const element = [
        ...document.querySelectorAll<HTMLElement>(
          `${scope} :is(button, a, [role="button"], [role="tab"], [role="option"], [tabindex])`,
        ),
      ]
        // An icon-only control (a folded pane rail's expand press) is named by its aria-label.
        .filter((e) => e.getClientRects().length > 0 && re.test(name(e)))
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (!element) return null;
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      return {
        text: name(element),
        title: element.title || element.getAttribute("aria-description") || "",
        disabled: element.matches(':disabled, [aria-disabled="true"]'),
        selected: !!element.closest('[aria-selected="true"]'),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },
    scope,
    pattern,
  );
}

async function press(page: TypedPage, scope: string, pattern: string, timeout = 60_000) {
  let hit: Awaited<ReturnType<typeof find>> = null;
  await expect
    .poll(async () => (hit = await find(page, scope, pattern))?.disabled ?? "absent", {
      timeout,
      message: `enabled control /${pattern}/ in ${scope}`,
    })
    .toBe(false);
  const { x, y } = hit!;
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"] as const)
    await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  return hit!;
}

function reading(page: TypedPage) {
  return page.evaluate(() => ({
    url: location.href,
    // Raw query values, before any router decode; null when the field is absent.
    raw: Object.fromEntries(
      location.search
        .slice(1)
        .split("&")
        .filter(Boolean)
        .map((pair) => [
          decodeURIComponent(pair.split("=")[0]),
          decodeURIComponent(pair.slice(pair.indexOf("=") + 1)),
        ]),
    ),
    panes: [...document.querySelectorAll<HTMLElement>("[data-pane-id]")]
      .filter((e) => e.getClientRects().length > 0 && e.innerText.trim().length > 0)
      .map((e) => e.dataset.paneId!),
  }));
}

async function capture(page: TypedPage, name: string, extra: unknown) {
  await mkdir(out(), { recursive: true });
  const shot = await page.send("Page.captureScreenshot", { format: "png" }).catch(() => null);
  if (shot) await writeFile(join(out(), `${name}.png`), Buffer.from(shot.data, "base64"));
  await writeFile(
    join(out(), `${name}.json`),
    JSON.stringify(
      {
        extra,
        reading: await reading(page).catch(String),
        errors: page.errors,
        consoleErrors: page.consoleErrors,
        body: await page.evaluate(() => document.body.innerText.slice(0, 8000)).catch(String),
      },
      null,
      2,
    ),
  );
}

/** Opens bare /fans, binds the controlled document through the visible chooser, opens MUAS-1. */
async function openFans(page: TypedPage) {
  await page.send("Page.navigate", { url: process.env.E2E_WEB! });
  const doc = process.env.E2E_DOC ?? "Chadds-purge";
  await expect
    .poll(
      async () =>
        (await reading(page)).panes.includes("sheet-roster") ||
        !!(await find(page, "body", "^choose$")),
      {
        timeout: 120_000,
        message: "fans roster or document chooser",
      },
    )
    .toBe(true);
  if (!(await reading(page)).panes.includes("sheet-roster")) {
    await press(page, "body", "^choose$");
    // Revit boots and opens the copy while this waits; the launcher's host starts first.
    await press(page, "body", doc, 600_000);
  }
  // A cold document read takes minutes; the roster row is the readiness signal. A retained
  // selection is kept: pressing a selected row would close it.
  const roster = '[data-pane-id="sheet-roster"]';
  // A read admitted while Revit attaches keeps its 409 until Refresh (observed on e6069eb6);
  // the person presses the roster's visible Refresh, as the pane offers.
  for (let end = Date.now() + 600_000; !(await find(page, roster, "^MUAS-1")); ) {
    if (Date.now() > end) throw new Error("MUAS-1 never drew on the fans roster");
    await new Promise((done) => setTimeout(done, 30_000));
    if (!(await find(page, roster, "^MUAS-1")) && (await find(page, roster, "^Refresh$")))
      await press(page, roster, "^Refresh$");
  }
  if (!(await find(page, roster, "^MUAS-1"))!.selected) await press(page, roster, "^MUAS-1");
}

async function settle(page: TypedPage, label: string, panes: string[], field: string) {
  const checkpoint = async () => {
    const now = await reading(page);
    const value = now.raw[field];
    let decodes = true;
    try {
      if (value !== undefined) JSON.parse(value);
    } catch {
      decodes = false;
    }
    return {
      label,
      panes: panes.filter((pane) => now.panes.includes(pane)),
      [`${field} decodes`]: decodes,
      malformed: page.consoleErrors.filter((line) => MALFORMED.test(line)),
    };
  };
  await expect
    .poll(checkpoint, { timeout: 60_000, message: label })
    .toEqual({ label, panes, [`${field} decodes`]: true, malformed: [] });
  return checkpoint();
}

// The join case runs first: a red resume leaves the thread's /fans address undecodable.
test("MUAS-1 return join is accepted from a visible enabled control and stages a join", async () => {
  const home = process.env.PE_TOOLS_PRODUCT_HOME;
  if (!home) throw new Error("PE_TOOLS_PRODUCT_HOME names the host's Work store");
  const page = await connectTypedPage();
  const assumptions = async () =>
    (await workEvidence(home)).flatMap(({ file, record }) =>
      Object.keys(record?.value?.doc?.assumptions ?? {}).map((key) => `${file}:${key}`),
    );
  const seen: unknown[] = [];
  try {
    await openFans(page);
    const before = await assumptions();
    // The exact row from the walk: an inferred join on MUAS-1's return run.
    const join = "^accept join → 30″x30″ duct";
    const drawn = async (scope: string, pattern: string) => {
      await expect
        .poll(async () => !!(await find(page, scope, pattern)), { timeout: 120_000 })
        .toBe(true)
        .catch(() => undefined);
      return find(page, scope, pattern);
    };
    let scope = '[data-pane-id="sheet-ledger"]';
    let control = await drawn(scope, join);
    seen.push({ route: "/fans", control });
    if (!control || control.disabled) {
      // The refusal points to /ducts; the person goes there and looks in the Rulings inbox.
      await page.send("Page.navigate", { url: new URL("/ducts", process.env.E2E_WEB!).href });
      scope = '[data-pane-id="e-inbox"]';
      await new Promise((done) => setTimeout(done, 10_000));
      if (!(await find(page, scope, "."))) await press(page, "body", "^Expand Rulings$");
      control = await drawn(scope, "^accept join");
      seen.push({ route: "/ducts", control });
    }
    expect(control, "an accept-join control is drawn on /fans or /ducts").not.toBeNull();
    expect(control!.disabled, `accept join is enabled (${control!.title})`).toBe(false);
    await press(page, scope, control!.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    // Independent read-back: the canonical route-work files gain a staged join ruling.
    await expect
      .poll(async () => (await assumptions()).filter((key) => !before.includes(key)), {
        timeout: 30_000,
        message: "staged join in route-work assumptions",
      })
      .not.toEqual([]);
    await capture(page, "join-staged", { seen, before, after: await assumptions() });
  } catch (error) {
    await capture(page, "join-failed", { seen });
    throw error;
  } finally {
    await page.close();
  }
});

test("resume round trip keeps /fans decodable and drawn through tabs, history and reload", async () => {
  const page = await connectTypedPage();
  const checkpoints: unknown[] = [];
  try {
    await openFans(page);
    // Non-vacuous anchor: the four panes, a decodable inputSort and a quiet console hold here today.
    checkpoints.push(await settle(page, "fans first open", FANS_PANES, "inputSort"));
    expect(
      (await reading(page)).raw.inputSort,
      "the Driver's start state carries inputSort",
    ).toBeDefined();
    // The person types /ducts once (Driver step b); that opens the Ducts tab beside Fans.
    await page.send("Page.navigate", { url: new URL("/ducts", process.env.E2E_WEB!).href });
    checkpoints.push(await settle(page, "ducts typed", DUCTS_PANES, "threadSort"));
    for (const [label, tab, panes, field] of [
      ["fans tab", "^Fans\\b", FANS_PANES, "inputSort"],
      ["ducts tab", "^Ducts\\b", DUCTS_PANES, "threadSort"],
      ["fans tab again", "^Fans\\b", FANS_PANES, "inputSort"],
    ] as const) {
      await press(page, '[data-pane-id="tools"]', tab);
      checkpoints.push(await settle(page, label, [...panes], field));
    }
    for (const [label, delta, panes, field] of [
      ["back to ducts", -1, DUCTS_PANES, "threadSort"],
      ["forward to fans", 1, FANS_PANES, "inputSort"],
    ] as const) {
      const history = await page.send("Page.getNavigationHistory");
      await page.send("Page.navigateToHistoryEntry", {
        entryId: history.entries[history.currentIndex + delta]!.id,
      });
      checkpoints.push(await settle(page, label, [...panes], field));
    }
    const loads = page.loadCount();
    await page.send("Page.reload", { ignoreCache: true });
    await expect.poll(() => page.loadCount(), { timeout: 30_000 }).toBeGreaterThan(loads);
    checkpoints.push(await settle(page, "reload fans", FANS_PANES, "inputSort"));
  } catch (error) {
    await capture(page, "resume-failed", { checkpoints });
    throw error;
  } finally {
    await writeFile(join(out(), "resume-checkpoints.json"), JSON.stringify(checkpoints, null, 2));
    await page.close();
  }
});
