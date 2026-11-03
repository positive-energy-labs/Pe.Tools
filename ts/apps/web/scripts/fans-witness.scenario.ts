import assert from "node:assert/strict";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { connect, CTRL } from "../../../tests/e2e/cdp.ts";
import { JOIN_KEY } from "@pe/ducts-domain/sheet/index";

// The launcher owns the fixture and Chrome. This driver borrows its explicit CDP target;
// all UI actions are trusted input through the existing pe-browser e2e helper.
const run = Number(process.env.FANS_RUN ?? 1);
const dir = fileURLToPath(
  new URL(`../../../../.artifacts/tmp/fans/witness-${run}/`, import.meta.url),
);
const receipt = JSON.parse(await readFile(`${dir}receipt.json`, "utf8")) as {
  host: string;
  target: string;
  browser: { endpoint: string };
  result: string;
};
assert.equal(receipt.result, "running");
const page = await connect(Number(new URL(receipt.browser.endpoint).port), receipt.target);
const mode = process.argv[2] ?? "inspect";
const evidence = async () => {
  const response = await fetch(`${receipt.host}/fixture/evidence`);
  assert.equal(response.status, 200);
  return response.json() as Promise<{
    native: [string | number, number][];
    work: { revision: number; doc: Record<string, any> };
    receipts: any[];
    events: any[];
    dispatched: any[];
  }>;
};
const record = async (name: string, detail: unknown = {}) => {
  await appendFile(
    `${dir}scenarios.jsonl`,
    JSON.stringify({ at: new Date().toISOString(), case: name, detail }) + "\n",
  );
  console.log(`PASS ${name}`);
};
async function pick(noun: "fan" | "system", text: string) {
  await page.click(`Choose ${noun}`);
  const search = `input[aria-label="${noun} search"]`;
  if (await page.count(search)) {
    await page.clickAt(search);
    await page.press("a", CTRL);
    await page.type(text);
  }
  const selector = await page.until(async () => {
    const options = await page.read<{ key: string; text: string }[]>(
      `[...document.querySelectorAll('[role="option"][data-key]')].filter(e=>e.getClientRects().length).map(e=>({key:e.getAttribute('data-key'),text:e.innerText}))`,
    );
    const option = options.find((option) => option.text.includes(text));
    return option && `[role="option"][data-key=${JSON.stringify(option.key)}]`;
  }, `${noun} option ${text}`);
  await page.clickAt(selector);
  await page.press("Escape");
}
async function numeric(key: string, value: string) {
  await page.clickAt(`[data-input-field=${JSON.stringify(key)}] input`);
  await page.press("a", CTRL);
  await page.press("Delete");
  await page.type(value);
  await page.press("Enter");
}
try {
  if (mode === "inspect") {
    await page.waitText("fans-a", 60_000);
    await page.dump(dir, "initial");
    console.log((await page.text()).slice(0, 14000));
    console.log(JSON.stringify(await evidence()).slice(0, 1800));
  } else if (mode === "pick") {
    await pick("fan", "MUAS-1");
    await page.waitText("MUAS-1");
    const url = await page.url();
    assert(new URL(url).searchParams.get("fan")?.includes("ducts-fan"));
    await page.reload();
    await page.waitText("MUAS-1", 60_000);
    assert.equal(await page.url(), url);
    await page.dump(dir, "muas-restored");
    await record("fan pick and MUAS-1 URL restore", { url });
  } else if (mode === "edits") {
    const before = await evidence();
    await page.clickAt('[data-protocol-slot="fanFlow"] button');
    await page.clickAt('[role="option"][data-key="PE_M_Fan_AirFlowMax"]');
    await page.until(
      async () =>
        (await evidence()).work.doc.parameters.fanFlow?.edit?.value === "PE_M_Fan_AirFlowMax",
      "slot Work write",
    );
    await numeric("unit:14577391:cfm", "900");
    await page.until(
      async () => (await evidence()).work.doc.equipmentFlows["14577391"]?.edit?.value.cfm === 900,
      "unit flow Work write",
    );
    const fields = await page.read<string[]>(
      `[...document.querySelectorAll('[data-input-field]')].map(e=>e.getAttribute('data-input-field'))`,
    );
    const drop = fields.find((key) => key.startsWith("component:") && key.endsWith(":drop"));
    assert(drop, "captured fan has a component drop editor");
    await numeric(drop, "0.18");
    const id = drop.split(":")[1]!;
    await page.until(
      async () => (await evidence()).work.doc.componentDrops[id]?.edit?.value.inWg === 0.18,
      "component drop Work write",
    );
    await page.reload();
    await page.waitText("MUAS-1", 60_000);
    const undo = await page.read<string>(
      `document.querySelector('[data-inputs-history] button')?.getAttribute('aria-label')`,
    );
    assert.match(undo, /Undo/);
    await page.click(/^Undo/, "[data-inputs-history]");
    await page.until(
      async () => !(await evidence()).work.doc.componentDrops[id]?.edit,
      "Undo drop",
    );
    assert(
      !/in-wg|cfm/.test(await page.textOf("[data-inputs-effect]")),
      "moved history has no effect numbers",
    );
    await page.click(/^Redo/, "[data-inputs-history]");
    await page.until(
      async () => (await evidence()).work.doc.componentDrops[id]?.edit?.value.inWg === 0.18,
      "Redo drop",
    );
    await page.clickAt(`[data-input-field=${JSON.stringify(drop)}] button[aria-label^="Revert"]`);
    await page.until(
      async () => !(await evidence()).work.doc.componentDrops[id]?.edit,
      "Revert drop",
    );
    await page.click(/^Restore/, "[data-sheet-inputs]");
    await page.until(
      async () => (await evidence()).work.doc.componentDrops[id]?.edit?.value.inWg === 0.18,
      "cleared row Restore",
    );
    assert.deepEqual(
      (await evidence()).native,
      before.native,
      "Work edits leave native model untouched",
    );
    const text = await page.text();
    assert.match(text, /ESP|pressure/i);
    assert.match(text, /Work|typed|source/i);
    await page.dump(dir, "edited-history");
    await writeFile(`${dir}edited.json`, JSON.stringify({ drop, id }, null, 2));
    await record("slot/drop, named cold history, Undo/Redo, Revert/Restore, ESP/provenance", {
      drop,
      undo,
    });
  } else if (mode === "join") {
    const config = (await fetch(`${receipt.host}/fixture/config`).then((response) =>
      response.json(),
    )) as { join: [string, string] };
    const key = JOIN_KEY(config.join);
    const before = await evidence();
    const response = await fetch(`${receipt.host}/fixture/pea-work`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Accept fan duct join",
        patches: [
          {
            path: ["assumptions", key],
            value: { edit: { value: { kind: "verdict", verdict: "connect" } } },
          },
        ],
      }),
    });
    assert.equal(response.status, 200, await response.text());
    await page.until(
      async () => (await evidence()).work.doc.assumptions[key]?.edit?.value.verdict === "connect",
      "Pea authored join through canonical Work API",
    );
    await page.reload();
    await page.waitText("Accept fan duct join", 60_000);
    await page.click(/^Undo/, "[data-inputs-history]");
    await page.until(
      async () => !(await evidence()).work.doc.assumptions[key]?.edit,
      "Undo Pea join",
    );
    await page.click(/^Redo/, "[data-inputs-history]");
    await page.until(
      async () => (await evidence()).work.doc.assumptions[key]?.edit?.value.verdict === "connect",
      "Redo Pea join",
    );
    assert.deepEqual((await evidence()).native, before.native);
    await page.dump(dir, "join-history");
    await record("Pea join edit, named history across reload, human Undo/Redo", { key });
  } else if (mode === "review") {
    await page.click("Choose write scope");
    await page.until(
      async () => Boolean((await evidence()).work.doc.writeIntent?.edit),
      "scoped write intent",
    );
    const before = await evidence();
    await page.click("Write to Revit");
    await page.waitText("Commit", 30_000);
    const review = await page.text();
    assert.match(review, /MUAS-1|DS-1/);
    assert.match(review, /0\.18|900/);
    assert.deepEqual(
      (await evidence()).native,
      before.native,
      "preview leaves native model untouched",
    );
    await page.dump(dir, "named-review");
    await page.click(/^Commit Write to Revit/);
    await page.until(
      async () =>
        (await evidence()).dispatched.filter((row) => row.key === "ducts.apply").length >
        before.dispatched.filter((row) => row.key === "ducts.apply").length,
      "native sealed commit",
      30_000,
    );
    const after = await evidence();
    assert.equal(new Map(after.native).get(999), 777, "off-scope sentinel untouched");
    assert.notDeepEqual(after.native, before.native);
    await record("scoped preview → named review → human consent → commit", {
      scope: before.work.doc.writeIntent,
      receipts: after.receipts,
    });
  } else if (mode === "pea-reject" || mode === "pea-deadline") {
    await page.click("Choose write scope");
    const before = await evidence();
    await page.click("Pea sealed write");
    await page.until(
      async () =>
        (await evidence()).events.filter((event) => event.kind === "permission_request").length >
        before.events.filter((event) => event.kind === "permission_request").length,
      "Pea Reject window",
      30_000,
    );
    assert.deepEqual(
      (await evidence()).native,
      before.native,
      "waiting consent leaves native model untouched",
    );
    await page.dump(dir, mode);
    if (mode === "pea-reject") await page.click(/^Reject/);
    await page.until(
      async () => {
        const after = await evidence();
        return after.receipts.some(
          (row) =>
            !before.receipts.some((old) => old.id === row.id) &&
            row.key === "ducts.apply-losses" &&
            ["succeeded", "refused", "failed", "cancelled"].includes(row.state),
        );
      },
      `${mode} receipt`,
      75_000,
    );
    const after = await evidence();
    const applies = (rows: typeof after.dispatched) =>
      rows.filter((row) => row.key === "ducts.apply").length;
    assert.equal(
      applies(after.dispatched) - applies(before.dispatched),
      mode === "pea-reject" ? 0 : 1,
    );
    assert.equal(new Map(after.native).get(999), 777);
    if (mode === "pea-reject") assert.deepEqual(after.native, before.native);
    await record(mode, { receipts: after.receipts, events: after.events });
  } else if (mode === "places") {
    const a = await page.url();
    await page.click("fans-b", 'nav[aria-label="Fixture Places"]');
    await pick("fan", "FC-23");
    const b = await page.url();
    assert.notEqual(a, b);
    await page.click("fans-a", 'nav[aria-label="Fixture Places"]');
    assert.equal(await page.url(), a);
    await page.waitText("MUAS-1");
    await page.click("fans-b", 'nav[aria-label="Fixture Places"]');
    assert.equal(await page.url(), b);
    await page.waitText("FC-23");
    await record("two retained Places keep independent fan URLs", { a, b });
  } else if (mode === "stale") {
    const before = await evidence();
    await page.open(`${receipt.host}/fans?stale=1`);
    await page.waitText("Reload this tab", 60_000);
    assert.deepEqual((await evidence()).work, before.work, "stale tab cannot edit Work");
    await page.dump(dir, "stale-reload");
    await page.open(`${receipt.host}/fans`);
    await page.waitText("Choose fan", 60_000);
    await record("stale fans tab is refused with reload");
  } else if (mode === "ducts") {
    await page.click("ducts", 'nav[aria-label="Fixture Places"]');
    await page.click("All system");
    await page.until(
      async () => new URL(await page.url()).searchParams.get("system")?.includes('"all"'),
      "all systems URL",
    );
    await page.click("No system");
    await page.until(
      async () => new URL(await page.url()).searchParams.get("system")?.includes('"ids":[]'),
      "no systems URL",
    );
    const config = (await fetch(`${receipt.host}/fixture/config`).then((response) =>
      response.json(),
    )) as { system: string };
    await pick("system", config.system);
    await page.reload();
    await page.waitText(config.system, 60_000);
    await page.dump(dir, "ducts-owner");
    await record("ducts owner: all/none/system restored in admitted chrome", {
      url: await page.url(),
    });
  } else throw Error(`Unknown scenario ${mode}`);
} catch (error) {
  await page.dump(dir, `failed-${mode}`).catch(() => {});
  await appendFile(
    `${dir}scenarios.jsonl`,
    JSON.stringify({ at: new Date().toISOString(), case: mode, failure: String(error) }) + "\n",
  );
  throw error;
} finally {
  await page.close();
}
