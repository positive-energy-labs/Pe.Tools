// Two real-Revit witnesses for /fans (Driver walk on e6069eb6, Chadds). Both start RED.
// No-Revit /fans?demo=navigation draws only "Choose a document", so neither runs on the owned fixture.
// Run: PE_TOOLS_PRODUCT_HOME=<drive home> route-chaos-launch.ts --suite fans --revit --source <checkout>;
// once its host holds the service claim, start a controlled Revit from the same checkout with the
// same PE_TOOLS_PRODUCT_HOME and open a Chadds copy. Pe.App then joins that host.
import { execFileSync } from "node:child_process";
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
  await click(page, hit!.x, hit!.y);
  return hit!;
}

async function click(page: TypedPage, x: number, y: number) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"] as const)
    await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
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

// H1 (Driver, kernel cdac2356): MUAS-1 and MUAS-2 share one type, and that type owns
// PE_M_Fan_ExternalStaticPressure. Staging MUAS-1's ESP and pressing Write to Revit must refuse,
// naming MUAS-2 or the type, and move nothing. The native read runs the served checkout's pea.
const H1_PROBE = `using Autodesk.Revit.DB;
var units = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_MechanicalEquipment)
  .WhereElementIsNotElementType().Cast<FamilyInstance>()
  .Where(f => f.Symbol.LookupParameter("PE_M_Fan_ExternalStaticPressure") != null)
  .Select(f => new { id = f.Id.Value, type = f.Symbol.FamilyName + ": " + f.Symbol.Name, typeId = f.Symbol.Id.Value,
    espType = f.Symbol.LookupParameter("PE_M_Fan_ExternalStaticPressure").AsDouble(),
    espInstance = f.LookupParameter("PE_M_Fan_ExternalStaticPressure")?.Element.Id == f.Id }).ToList();
Result(new { units, store = doc.ProjectInformation.LookupParameter("_PE_DuctLosses")?.AsString() });`;
type H1Unit = { id: number; type: string; typeId: number; espType: number; espInstance: boolean };
const nativeFans = () =>
  JSON.parse(
    execFileSync(
      process.execPath,
      // E2E_OPEN_ID: the controlled document's openId (`pe-revit doc open` prints it).
      ["--import", "jiti/register", "src/main.ts", "script", "execute", "--stdin", "--json"].concat(
        ["--open-document-id", process.env.E2E_OPEN_ID!],
      ),
      {
        cwd: join(process.env.CHAOS_PRODUCT_ROOT!, "ts/apps/pea"),
        input: H1_PROBE,
        encoding: "utf8",
      },
    ),
  ).data as { units: H1Unit[]; store: string | null };

test("H1: a MUAS-1 ESP write refuses for its shared type and MUAS-2 keeps its value", async () => {
  const home = process.env.PE_TOOLS_PRODUCT_HOME;
  if (!home) throw new Error("PE_TOOLS_PRODUCT_HOME names the host's Work store");
  const page = await connectTypedPage();
  const seen: Record<string, unknown> = {};
  try {
    await openFans(page);
    // openFans opened the roster's one MUAS-1 row, port 2 (the Driver's walk). The open fan
    // draws its own Unit ESP row; its key carries MUAS-1's element id.
    const espRow = () =>
      page.evaluate(() => {
        const row = document.querySelector<HTMLElement>(
          '[data-pane-id="sheet-inputs"] [data-input-field^="unit:"][data-input-field$=":esp"]',
        );
        const input = row?.querySelector("input");
        if (!row || !input) return null;
        input.scrollIntoView({ block: "center" });
        const r = input.getBoundingClientRect();
        return { key: row.dataset.inputField!, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    // A cold sheet read may stay unavailable until the pane's visible Refresh, as on the roster.
    const inputs = '[data-pane-id="sheet-inputs"]';
    for (let end = Date.now() + 300_000; !(await espRow()); ) {
      if (Date.now() > end) throw new Error("MUAS-1's Unit ESP row never drew");
      await new Promise((done) => setTimeout(done, 30_000));
      if (!(await espRow()) && (await find(page, inputs, "^Refresh$")))
        await press(page, inputs, "^Refresh$");
    }
    const row = (await espRow())!;
    const muas1 = Number(row.key.split(":")[1]);
    const before = nativeFans();
    const unit = before.units.find((u) => u.id === muas1);
    const peers = before.units.filter((u) => u.typeId === unit?.typeId && u.id !== muas1);
    seen.before = before;
    expect(unit?.espInstance, "MUAS-1's ESP is owned by its type").toBe(false);
    expect(peers.length, "MUAS-1's type has another unit (MUAS-2)").toBeGreaterThan(0);
    // The person clicks the visible box, replaces its text (Ctrl+A), types the ESP and presses Enter.
    await click(page, row.x, row.y);
    for (const type of ["keyDown", "keyUp"] as const)
      await page.send("Input.dispatchKeyEvent", {
        type,
        key: "a",
        code: "KeyA",
        modifiers: 2,
        commands: ["selectAll"],
      });
    await page.send("Input.insertText", { text: "2.6581" });
    for (const type of ["keyDown", "keyUp"] as const)
      await page.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
    // Non-vacuous checkpoint: the edit is staged in fans Work and the write control is drawn.
    const staged = async () =>
      (await workEvidence(home)).some(
        ({ record }) =>
          record?.route === "fans" && record.value?.doc?.esp?.[muas1]?.edit?.value?.inWg === 2.6581,
      );
    await expect
      .poll(staged, { timeout: 30_000, message: "MUAS-1 ESP staged in fans Work" })
      .toBe(true);
    // The person scopes the write to this fan, then re-reads the sheet the edits made stale.
    await press(page, '[data-choice-cell="Write scope"]', "^None");
    await press(page, '[role="listbox"]', "^MUAS-1 · \\d+ staged");
    await expect
      .poll(() => find(page, '[data-choice-cell="Write scope"]', "^MUAS-1 · "), { timeout: 30_000 })
      .not.toBeNull();
    const demanded = () =>
      page.evaluate(() =>
        /Explicit demand|Showing previous reading|Reading\.\.\./.test(
          document.querySelector('[data-pane-id="sheet-inputs"]')!.textContent!,
        ),
      );
    await expect
      .poll(demanded, { timeout: 15_000 })
      .toBe(true)
      .catch(() => undefined);
    await press(page, inputs, "^Refresh$");
    await expect.poll(demanded, { timeout: 120_000, message: "sheet re-read" }).toBe(false);
    const state = () =>
      page.evaluate(() => ({
        popover: document.querySelector('[data-write-outcome="refused"]')?.textContent ?? null,
        armed: !!document.querySelector('[data-write-action="armed"]'),
        chip: /ducts\.plan-losses\nyou · \w+ · [\d:]+/.exec(document.body.innerText)?.[0] ?? null,
      }));
    const prior = (await state()).chip;
    seen.write = await press(page, "body", "^plan Write to Revit$");
    await expect
      .poll(
        async () =>
          ((s) => !!s.popover || s.armed || (s.chip !== prior && /refused/.test(s.chip!)))(
            await state(),
          ),
        {
          timeout: 300_000,
          message: "plan outcome",
        },
      )
      .toBe(true);
    const plan = (seen.plan = await state());
    // A host-refused plan draws no popover outcome, only the header's timeline chip; its History names why.
    if (!plan.popover && !plan.armed) await press(page, "body", "^ducts\\.plan-losses");
    const refusal = (seen.refusal =
      plan.popover ??
      (await page.evaluate(
        () =>
          /ducts\.plan-losses\nrefused \/ you \/ [\d:]+ \/ ([^\n]+)/.exec(
            document.body.innerText,
          )?.[1] ?? null,
      )));
    // Without the refusal, the person applies what the plan offers (the Driver's hazard).
    if (plan.armed) seen.apply = await press(page, "[data-write-popover]", "^Write to Revit$");
    await capture(page, "h1-plan", seen);
    const after = (seen.after = nativeFans());
    expect(after.units, "no unit of the shared type moved").toEqual(before.units);
    expect(after.store, "no duct-loss store was written").toBe(before.store);
    expect(await staged(), "the refused plan keeps MUAS-1's staged ESP").toBe(true);
    expect(plan.armed, "no Apply was armed").toBe(false);
    const named = [unit!.type, ...peers.flatMap((p) => ["MUAS-2", String(p.id)])];
    expect(
      named.filter((name) => refusal?.includes(name)),
      `refusal: ${refusal}`,
    ).not.toEqual([]);
  } catch (error) {
    await capture(page, "h1-failed", seen);
    throw error;
  } finally {
    await page.close();
  }
});
