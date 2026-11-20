// Fixture: node --import jiti/register tests/journey-fixtures/jv7-launch.ts
// Real: E2E_WEB=<bound fans URL with thread and target>, JV7_HOST=<host origin>,
// JV7_TOKEN=<service token>, E2E_CONTEXT_PATH=<own CLI context file>, CDP_PORT/CDP_TARGET=<owned tab>;
// node --import jiti/register tests/journey-fixtures/jv7-fans.ts
// The real target requires the driver’s own controlled session; this journey never discovers or starts Revit.
import { assertPageBinding } from "../e2e/page-binding.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { journey, WEB } from "../e2e/cdp.ts";
import { marks, settled } from "../e2e/marks.ts";
import { fanRosterLabel } from "./fan-roster.ts";

const missing = "UniqueId:f2f7a0d6-placeholder";
await journey("J-V7", async (page, step, dir) => {
  const url = new URL(WEB);
  const thread = url.searchParams.get("thread");
  if (!thread || !process.env.JV7_HOST || !process.env.JV7_TOKEN)
    throw Error("PRECONDITION: bound E2E_WEB thread, JV7_HOST and JV7_TOKEN required");
  const token = process.env.JV7_TOKEN;
  const context = process.env.E2E_CONTEXT_PATH
    ? readFileSync(process.env.E2E_CONTEXT_PATH, "utf8").trim()
    : undefined;
  if (process.env.E2E_LINKAGE_MODE !== "fixture-linkage" && !context)
    throw Error("PRECONDITION: E2E_CONTEXT_PATH for own CLI caller required");
  if (process.env.E2E_TARGET) {
    const target = JSON.parse(process.env.E2E_TARGET);
    if (target.kind !== "document") throw Error("PRECONDITION: document execution target required");
    url.searchParams.set("target", JSON.stringify({ kind: "open", ref: target.ref }));
  }
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${process.env.JV7_HOST}/pe/route-view/fans${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-pe-service-token": token,
        ...(context ? { "x-pe-context": context } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.json() };
  };
  step("open bound /fans and wait for the published route and real roster");
  await page.open(url.href);
  await page.until(async () => settled(await marks(page)), "settled fans", 120_000);
  const labels = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="listbox"][aria-label="fans"] [role="option"]',
        ),
      ]
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => e.innerText.trim()),
    );
  await page.until(async () => (await labels()).length > 0, "nonempty fans roster", 120_000);
  const lease = await page.until(async () => {
    const result = await call(`?thread=${encodeURIComponent(thread)}`);
    return result.status === 200 && result.body.instance && typeof result.body.revision === "number"
      ? result.body
      : null;
  }, "accepted fans lease");
  step(`ask set-view for ${missing}`);
  const request = {
    thread,
    instance: lease.instance,
    revision: lease.revision,
    patch: { fan: JSON.stringify({ kind: "ids", ids: [missing] }) },
  };
  await assertPageBinding(page);
  const reply = await call("/set", request);
  writeFileSync(join(dir, "set-view.json"), JSON.stringify({ request, reply }, null, 2));
  step(`set-view acknowledgement: ${JSON.stringify(reply)}`);
  await page.dump(dir, "ack");
  const ack = reply.body.error?.details ?? reply.body;
  if (ack.outcome !== "refused" || !JSON.stringify(ack.refusal).includes(missing))
    throw Error(`ASSERT missing fan refused by name (${missing}); saw ${JSON.stringify(reply)}`);
  const selection = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[role="listbox"][aria-label="fans"] [aria-selected="true"]')]
        .map((e) => e.textContent)
        .sort(),
    );
  const before = await selection();
  const rowText = (await labels()).find((label) => !before.some((text) => text?.trim() === label));
  if (!rowText)
    throw Error("PRECONDITION: an unselected fan row is required to prove selection changes");
  const row = /^(.*? \/ port \d+)/.exec(rowText)?.[1] ?? rowText;
  await assertPageBinding(page);
  const pressed = await page.gestures.click({
    role: "option",
    name: fanRosterLabel(row),
    within: '[role="listbox"][aria-label="fans"]',
  });
  if (pressed.outcome !== "done")
    throw Error(`ASSERT route remains usable: ${JSON.stringify(pressed)}`);
  await page.until(
    async () =>
      settled(await marks(page)) && JSON.stringify(await selection()) !== JSON.stringify(before),
    "roster responds after refusal",
    120_000,
  );
  step("route remains usable: roster selection responds");
});
