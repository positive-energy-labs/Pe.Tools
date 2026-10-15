// E2E-SNOW (plan P4) · the shipped snowdon-ducts Page drives a real Snowdon Towers sample copy end to end.
// Real controls only, assertions on rendered DOM. Needs a controlled dev session holding the open COPY and a
// host with the Pod imported through the normal import. Never run against the owner's session.
//
// E2E_PAGE_URL  the Page's open URL as the host projects it (copy it from the catalog row for page:@snowdon-ducts/pages/tour)
// E2E_MUTATE=1  also press the guarded experiment (the open document's title must contain "copy")
// Preconditions missing => BLOCKED (the page is unbound, no duct systems, no URL), never FAIL.
// Red break: rename KEYS.census in pages/tour/index.html => the census assertion fails.
import { expectText, journey } from "./cdp.ts";

const url = process.env.E2E_PAGE_URL;
if (!url)
  throw new Error("PRECONDITION: E2E_PAGE_URL (the Page open URL from the catalog) is unset");

await journey("SNOW", async (page, step) => {
  step(`open ${url}`);
  await page.open(url);

  step("press Census; the systems table draws from a script reading");
  await page.click("Census");
  await page
    .until(
      async () => /Duct systems[\s\S]*\bSystem\b[\s\S]*\bFittings\b/.test(await page.text()),
      "systems table",
      120_000,
    )
    .catch(async () => {
      const text = await page.text();
      if (/unbound|no document|choose|grant/i.test(text))
        throw new Error("PRECONDITION: the Page is not bound to the sample copy");
      throw new Error("ASSERT census: no systems table rendered");
    });
  const afterCensus = await page.text();
  if (/Listed 0|0 duct systems/i.test(afterCensus))
    throw new Error("PRECONDITION: the document has no duct systems");

  step("pick the first listed system, Inspect");
  const first = await page.read<string>(
    `document.querySelector("#systems button.pick")?.textContent ?? ""`,
  );
  if (!first) throw new Error("ASSERT pick: no system button rendered");
  await page.click(first, "#systems");
  await page.click("Inspect selected system");
  await page.until(
    async () => /fittings, \d+ with a loss parameter|unavailable/.test(await page.text()),
    "run summary",
    120_000,
  );

  step("Show in Revit and Capture view; a facsimile appears or the refusal is on the page");
  if (await page.has("Show in Revit")) {
    await page.click("Show in Revit");
    await page.click("Capture view");
    await page.until(
      async () => (await page.count("img.facsimile")) > 0,
      "facsimile image",
      120_000,
    );
  }

  step("save a shared note, reload, the note replays from the event log");
  await page.read(`document.getElementById("note").focus()`); // focus only; the keystrokes are trusted input
  await page.type("Observation from the acceptance run");
  await page.click("Save note");
  await page.reload();
  await page.until(
    async () => (await page.text()).includes("Observation from the acceptance run"),
    "note after reload",
  );

  if (process.env.E2E_MUTATE === "1") {
    step("guarded experiment on the copy; before, readback and applied are on the page");
    await page.click("Coefficient experiment (copy only)");
    await page.click("Confirm: change this copy");
    await page.until(
      async () => /Experiment: /.test(await page.text()),
      "experiment result",
      120_000,
    );
    const status = await page.text();
    expectText(
      status,
      /readback|unavailable|refused/,
      "experiment answered one of its three honest results",
    );
  }
});
