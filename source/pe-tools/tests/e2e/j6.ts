// E2E-J6 · Old Work is never silently lost. Needs the Revit session with the project-a target open
// (Work is keyed by a document Address the live inventory resolves) and an old-shape /families
// Work document seeded for it by exec-proof. E2E_TARGET = that document's Address.
// J6b: `E2E_PART=b` after the host is stopped: a failed read must not offer `start fresh`.
// Red break: drop the UNREADABLE_WORK gate on startFresh (route/use-route.ts) → J6b shows it.
import { expectText, journey, PLAN, requireRevit, SITUATION, WEB } from "./cdp.ts";

const TARGET = process.env.E2E_TARGET ?? "";
const PART = process.env.E2E_PART ?? "a";
const REFUSAL =
  "This route's saved Work is in a shape this version cannot read, so it was left untouched; it cannot be opened here.";
const url = `${WEB}/families${TARGET ? `?target=${encodeURIComponent(TARGET)}` : ""}`;

await journey(PART === "b" ? "J6b" : "J6", async (page, step) => {
  step(`open ${url}`);
  await page.open(url);

  if (PART === "b") {
    // Timing gate: the page settles on whatever the dead host leaves it; the DOM is the assertion.
    await page
      .until(
        async () => (await page.textOf('[role="status"][data-tone="caution"]')).trim(),
        "a failure status",
        30_000,
      )
      .catch(() => {});
    // data-tone is only the locator of the drawn caution line; the person must see its words.
    const status = await page.textOf('[role="status"][data-tone="caution"]');
    if (!status.trim())
      throw new Error(
        "ASSERT J6b a failed read renders a caution status with words: none rendered",
      );
    if (await page.has("start fresh"))
      throw new Error(
        'ASSERT J6b a failed read does not offer "start fresh": the control is rendered',
      );
    return;
  }

  // The seed is consumed by any "start fresh" (journeys' live J6 took project-a' real row), so its
  // absence is a missing precondition (README: seeding an old-shape Work), never a product FAIL.
  await requireRevit(page);
  await page.waitText(REFUSAL, 30_000).catch(() => {});
  if (!(await page.text()).includes(REFUSAL))
    throw new Error("PRECONDITION: no old-shape Work seeded");

  step("see the refusal sentence and a start fresh control");
  if (!(await page.has("start fresh")))
    throw new Error('ASSERT before: a "start fresh" control is rendered beside the refusal');

  step("click start fresh");
  await page.click("start fresh");
  await page
    .until(async () => !(await page.text()).includes(REFUSAL), "the refusal to clear", 30_000)
    .catch(() => {});

  expectText(await page.text(), REFUSAL, "after: the refusal is gone", false);
  if (await page.has("start fresh")) throw new Error('ASSERT after: "start fresh" is gone');
  if (!(await page.has(PLAN, SITUATION)))
    throw new Error('ASSERT after: the route shows its normal controls ("plan" verb)');
});
