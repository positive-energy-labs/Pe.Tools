import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { circuitCalculation } from "../../../../examples/pods/snowdon-circuits/pages/tour/circuits.mjs";
import { sizes } from "../../../../examples/pods/snowdon-circuits/pages/tour/calc.mjs";

const [url, output] = process.argv.slice(2);
if (!url || !output)
  throw new Error("node tests/browser.mjs <hosted-page-url> <evidence-directory>");
await mkdir(output, { recursive: true });
const evidence = {
  url,
  at: new Date().toISOString(),
  steps: [],
  screenshots: [],
  errors: [],
  warnings: [],
  requests: [],
  blockedNetwork: [],
  admissionHandoffs: [],
  passed: false,
};
const states = {};
const responseChecks = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const readState = (page) => page.evaluate(() => structuredClone(window.pageState.state));
const observe = (page, lane) => {
  page.on("response", (response) => {
    if (response.status() !== 409) return;
    responseChecks.push(
      (async () => {
        const body = await response.json();
        assert.ok(
          lane === "hosted" &&
            new URL(response.url()).pathname.endsWith("/call") &&
            body.notDispatched &&
            !body.resolution,
          "Unexpected 409 response",
        );
        evidence.admissionHandoffs.push({
          key: response.request().postDataJSON().key,
          status: 409,
          notDispatched: body.notDispatched,
        });
      })(),
    );
  });
  page.on("pageerror", (error) => evidence.errors.push({ lane, message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push({ lane, message: message.text() });
    if (message.type() === "warning") evidence.warnings.push({ lane, message: message.text() });
  });
  page.on("request", (request) => {
    if (request.method() !== "POST" || !new URL(request.url()).pathname.endsWith("/act")) return;
    const body = request.postDataJSON();
    evidence.requests.push({ lane, key: body.key, dryRun: body.input?.dryRun ?? null });
  });
};
const idle = async (page) => {
  await page.waitForFunction(() => !document.querySelector('main [role="status"]'), null, {
    timeout: 120_000,
  });
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    "Page reported a refused or failed action",
  );
};
const drop = async (page) => Number.parseFloat(await page.getByTestId("Percent drop").innerText());
const sameReading = (state, reading, selectedId) => {
  assert.deepEqual(state.reading.document, reading.document);
  assert.deepEqual(state.reading.rows, reading.rows);
  assert.equal(state.selectedId, selectedId, "Selection changed during presentation proof");
};
async function pictures(page, lane, reading, selectedId) {
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      for (let attempt = 0; (await readState(page)).theme !== theme && attempt < 2; attempt++) {
        const before = (await readState(page)).theme;
        await page.getByRole("button", { name: "Change theme", exact: true }).click();
        await page.waitForFunction((previous) => window.pageState.state.theme !== previous, before);
      }
      await page.waitForFunction(
        (wanted) => document.documentElement.dataset.theme === wanted,
        theme,
      );
      await page.locator(".diagram svg:not([aria-hidden])").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      if (geometry.scrollWidth > geometry.width + 1) {
        evidence.overflow = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .map((element) => ({
              tag: element.tagName,
              class: element.className?.baseVal ?? element.className,
              right: element.getBoundingClientRect().right,
              width: element.getBoundingClientRect().width,
            }))
            .filter((item) => item.right > innerWidth + 1),
        );
        await page.screenshot({ path: resolve(output, "overflow.png"), fullPage: true });
      }
      assert.ok(geometry.scrollWidth <= geometry.width + 1, `${lane} overflows at ${width}px`);
      assert.equal(geometry.scheme, theme);
      sameReading(await readState(page), reading, selectedId);
      const path = resolve(output, `${lane}-${width}-${theme}.png`);
      await page.screenshot({ path, fullPage: true });
      const bytes = (await stat(path)).size;
      assert.ok(bytes > 10_000, `${lane} screenshot is implausibly small`);
      evidence.screenshots.push({ lane, path, width, theme, bytes, geometry });
    }
  }
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  observe(page, "hosted");
  await page.goto(url);
  await page.getByRole("grid", { name: "Electrical circuits", exact: true }).waitFor();
  await page.waitForFunction(() => !!window.pageState && !!window.pe.kit?.React);
  const previousAt = (await readState(page)).reading?.at ?? 0;
  await page.getByRole("button", { name: "Read circuits", exact: true }).click();
  await page.waitForFunction((at) => window.pageState.state.reading?.at > at, previousAt, {
    timeout: 120_000,
  });
  await idle(page);
  const reading = (await readState(page)).reading;
  assert.ok(reading.rows.length > 0, "No real circuit rows were read");
  assert.match(reading.source, /revit\.catalog\.electrical-circuits/);
  assert.match(reading.source, /script:@snowdon-circuits\/src\/Census\.cs/);
  assert.ok(reading.document.session && reading.document.openId && reading.document.title);
  assert.ok(Number.isFinite(reading.at));
  evidence.reading = {
    source: reading.source,
    at: reading.at,
    document: reading.document,
    rows: reading.rows.length,
    total: reading.total,
  };
  states.read = await readState(page);
  evidence.steps.push(
    "Read circuits returned native measurements under an exact document identity",
  );

  evidence.defaultTarget = {
    target: Number(states.read.target),
    above: reading.rows.filter(
      (row) => circuitCalculation(row, {}, states.read.target).status === "above",
    ).length,
  };
  // The licensed sample is already sized below 3%; use an explicit stricter worksheet target.
  await page.getByRole("spinbutton", { name: "Design target percent", exact: true }).fill("1");
  await page.waitForFunction(() => Number(window.pageState.state.target) === 1);
  const target = 1;
  const supported = reading.rows.map((row) => ({
    row,
    calculation: circuitCalculation(row, {}, target),
  }));
  const candidate = supported
    .filter(
      ({ row, calculation }) =>
        calculation.status === "above" &&
        calculation.drop > 0 &&
        row.elementIds.length > 0 &&
        row.wireParameter?.isReadOnly,
    )
    .sort((a, b) => b.calculation.percent - a.calculation.percent)[0];
  evidence.candidateCensus = {
    supported: supported.filter((item) => item.calculation.status !== "unavailable").length,
    above: supported.filter((item) => item.calculation.status === "above").length,
  };
  assert.ok(
    candidate,
    "Actual reading has no supported nonzero over-target circuit with readonly Wire Size and connected elements",
  );
  const { row, calculation } = candidate;
  evidence.selected = {
    id: row.id,
    uniqueId: row.uniqueId,
    panel: row.panel,
    number: row.number,
    elementIds: row.elementIds,
    input: calculation.input,
    measuredPercent: calculation.percent,
    target,
  };
  await page.getByRole("textbox", { name: "Filter circuits", exact: true }).fill(String(row.id));
  await page
    .getByRole("button", { name: `Select ${row.panel} circuit ${row.number}`, exact: true })
    .click();
  await page.waitForFunction((id) => window.pageState.state.selectedId === id, row.id);
  await idle(page);
  assert.ok(
    (await drop(page)) > target,
    "Selected circuit does not display the measured over-target result",
  );
  states.selected = await readState(page);
  await page.getByRole("textbox", { name: "Filter circuits", exact: true }).fill("");
  evidence.steps.push(
    `Selected circuit ${row.id} from the actual reading; its nonzero measured drop exceeds the design target`,
  );

  const reducedLoad = calculation.input.amps / 2;
  await page.getByRole("spinbutton", { name: /^Apparent load/ }).fill(String(reducedLoad));
  await page.waitForFunction(
    ({ id, value }) => Number(window.pageState.state.overrides[id]?.amps) === value,
    { id: row.id, value: reducedLoad },
  );
  assert.ok(
    (await drop(page)) < calculation.percent,
    "Kit input did not change the calculated result",
  );
  await page.getByRole("button", { name: "Clear circuit overrides", exact: true }).click();
  await page.waitForFunction(
    (id) => Object.keys(window.pageState.state.overrides[id] ?? {}).length === 0,
    row.id,
  );
  const larger = sizes.find((item) => item.area > calculation.area);
  assert.ok(larger, "Measured conductor is already the largest supported conductor");
  await page.getByRole("button", { name: `Use ${larger.size} AWG`, exact: true }).click();
  await page.waitForFunction(
    ({ id, size }) => window.pageState.state.overrides[id]?.size === size,
    { id: row.id, size: larger.size },
  );
  assert.ok(
    (await drop(page)) < calculation.percent,
    "Conductor comparison did not change the calculated result",
  );
  await page.getByRole("button", { name: "Calc trace", exact: true }).click();
  await page.getByText("Calculation trace", { exact: true }).waitFor();
  assert.ok((await page.locator(".artifact-body").innerText()).includes(String(row.id)));
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByText("Editable Page source", { exact: true }).waitFor();
  assert.ok((await page.locator(".artifact-body").innerText()).includes("circuitCalculation"));
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  evidence.steps.push(
    "Kit numeric input, conductor comparison, trace and highlighted source views respond to interaction",
  );

  await page.getByRole("button", { name: "Prepare wire proposal", exact: true }).click();
  await page.waitForFunction(() => !!window.pageState.state.proposal, null, { timeout: 120_000 });
  await idle(page);
  const proposal = (await readState(page)).proposal;
  assert.equal(proposal.circuitId, row.id);
  assert.equal(proposal.input, null);
  assert.equal(proposal.evidence.isReadOnly, true);
  assert.match(proposal.blocked, /read-only/i);
  assert.equal(
    await page.getByRole("button", { name: "Approve and apply wire change", exact: true }).count(),
    0,
  );
  assert.equal(
    evidence.requests.filter(
      (request) => request.key === "revit.apply.parameter-values" && request.dryRun !== true,
    ).length,
    0,
    "Acceptance test dispatched a wire mutation",
  );
  states.proposal = await readState(page);
  evidence.steps.push(
    "Readonly native Wire Size produces a blocked review artifact with no executable input or Apply button",
  );

  await page.getByRole("button", { name: "Capture selected circuit", exact: true }).click();
  await page.waitForFunction(() => !!window.pageCapture, null, { timeout: 120_000 });
  await idle(page);
  const capture = await page.evaluate(() => structuredClone(window.pageCapture));
  assert.equal(capture.circuitId, row.id);
  assert.deepEqual(capture.document, reading.document);
  await page.locator(".capture img").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".capture img");
    return image?.complete && image.naturalWidth > 0;
  });
  const bytes = Buffer.from(
    await page.evaluate(async () => {
      const response = await pe.fetch(window.pageCapture.url);
      if (!response.ok) throw new Error(`Capture download failed: ${response.status}`);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }),
  );
  assert.ok(bytes.length > 10_000);
  assert.equal(hash(bytes), capture.sha);
  const capturePath = resolve(output, "revit-circuit.png");
  await writeFile(capturePath, bytes);
  await writeFile(resolve(output, "page-capture.json"), JSON.stringify(capture, null, 2));
  evidence.capture = { ...capture, path: capturePath, bytes: bytes.length };
  evidence.steps.push(
    "Native circuit capture is saved with matching content hash and exact document/circuit provenance",
  );
  await pictures(page, "hosted", reading, row.id);
  states.hosted = await readState(page);

  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export snapshot", exact: true }).click();
  const download = await downloadWait;
  const portablePath = resolve(output, "snapshot.html");
  await download.saveAs(portablePath);
  await idle(page);
  const html = await readFile(portablePath, "utf8");
  const provenance = JSON.parse(
    /<script id="pe-export" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
      "null",
  );
  assert.ok(provenance, "Export omitted pinned provenance");
  assert.deepEqual(provenance.document, reading.document);
  assert.equal(provenance.snapshotSha256, hash(JSON.stringify(provenance.snapshot)));
  assert.deepEqual(provenance.snapshot, states.hosted);
  assert.ok(
    provenance.files.some(
      (file) => file.path === "index.html" && /^[a-f0-9]{64}$/.test(file.sha256),
    ),
  );
  evidence.export = {
    path: portablePath,
    sha256: hash(html),
    exportedAt: provenance.exportedAt,
    page: provenance.page,
    document: provenance.document,
    snapshotSha256: provenance.snapshotSha256,
    files: provenance.files,
  };

  const offline = await context.newPage();
  observe(offline, "offline");
  await offline.route(/^https?:/i, (route) => {
    evidence.blockedNetwork.push(route.request().url());
    return route.abort();
  });
  await offline.goto(pathToFileURL(portablePath).href);
  await offline.waitForFunction(() => !!window.pageState && !!window.pe.kit?.React);
  await offline.locator(".diagram svg:not([aria-hidden])").waitFor();
  const exportedState = await readState(offline);
  assert.deepEqual(exportedState, provenance.snapshot);
  sameReading(exportedState, reading, row.id);
  const doors = await offline.evaluate(() =>
    ["target", "fetch", "find", "read", "do", "script", "picture"].filter((key) => key in pe),
  );
  assert.deepEqual(doors, []);
  for (const name of [
    "Read circuits",
    "Export snapshot",
    "Inspect selected circuit",
    "Capture selected circuit",
    "Prepare wire proposal",
    "Approve and apply wire change",
  ])
    assert.equal(await offline.getByRole("button", { name, exact: true }).count(), 0);
  assert.equal(
    await offline.locator(".capture img").count(),
    0,
    "Native capture URL escaped into portable state",
  );
  const offlineBefore = await drop(offline);
  await offline.getByRole("spinbutton", { name: /^Apparent load/ }).fill(String(reducedLoad));
  await offline.waitForFunction(
    ({ id, value }) => Number(window.pageState.state.overrides[id]?.amps) === value,
    { id: row.id, value: reducedLoad },
  );
  assert.ok((await drop(offline)) < offlineBefore);
  await pictures(offline, "offline", reading, row.id);
  states.offline = await readState(offline);
  assert.deepEqual(
    evidence.blockedNetwork,
    [],
    "Portable presentation attempted a network request",
  );
  await Promise.all(responseChecks);
  const handoffMessages = evidence.errors.filter(
    (item) =>
      item.lane === "hosted" &&
      item.message ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)",
  );
  assert.equal(handoffMessages.length, evidence.admissionHandoffs.length);
  evidence.errors = evidence.errors.filter((item) => !handoffMessages.includes(item));
  assert.deepEqual(evidence.errors, []);
  evidence.steps.push(
    "file:// snapshot preserves measured document/rows and edits its calculator with Mermaid, zero network and no live doors",
  );
  evidence.passed = true;
} catch (error) {
  evidence.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(output, "browser-states.json"), JSON.stringify(states, null, 2));
  await writeFile(resolve(output, "browser-proof.json"), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
