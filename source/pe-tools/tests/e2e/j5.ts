// E2E-J5 · An ask lives exactly as long as its turn. Real host, real Pea; no Revit.
// Red break: drop the `new-turn` expiry → the old question stays in the head after the new message.
import { expectText, journey, requirePea, setPea, sendChat, WEB } from "./cdp.ts";

const HEAD = '[aria-label="Pea proposals"]';
const COMPOSER = 'textarea[aria-label="Message"]';

await journey("J5", async (page, step) => {
  step(`open ${WEB}/chat, click "new"`);
  await page.open(`${WEB}/chat`);
  await page.click("new");
  await page.waitText("NO MESSAGES IN THIS THREAD YET");
  await setPea(page);
  await requirePea(page);

  step("type an ask-provoking message + Enter");
  await sendChat(
    page,
    'Call the ask_user tool once with question "red or blue?" and options ["red", "blue"]. Then wait for my answer.',
  );
  await page.until(
    async () => (await page.textOf(HEAD)).includes("Ask User"),
    "Ask User in the Chat head",
    180_000,
  );

  step("reload the browser");
  await page.reload();
  await page.until(
    async () => (await page.textOf(HEAD)).includes("Ask User"),
    "Ask User in the head after reload",
    30_000,
  );
  expectText(
    await page.textOf(HEAD),
    "Ask User",
    "after reload the question is still in the Chat head",
  );
  expectText(await page.text(), "red or blue?", "after reload the question text is rendered");
  if (!(await page.has("red")))
    throw new Error(
      'ASSERT after reload the ask still has its answer control: no visible "red" answer button',
    );

  step("type a new message + Enter instead of answering");
  // Not sendChat: sending over the parked ask, without cancelling it, is the journey's act.
  await page.clickAt(COMPOSER);
  await page.type("Never mind the question; just say hi.");
  await page.press("Enter");
  // Timing gate only: give the new turn time to land; the assertions below read the DOM.
  await page
    .until(
      async () => !(await page.textOf(HEAD)).includes("Ask User"),
      "the head to drop the ask",
      60_000,
    )
    .catch(() => {});

  // A textarea's value is not innerText, so this only passes once the message renders as a turn.
  expectText(
    await page.text(),
    "Never mind the question; just say hi.",
    "the new message is sent into the transcript",
  );
  expectText(
    await page.textOf(HEAD),
    "Ask User",
    "after the new message the head no longer shows the ask",
    false,
  );
  expectText(
    await page.text(),
    "Ask User — expired, unanswered",
    "transcript shows the expired record",
  );
  if (await page.has("red"))
    throw new Error(
      'ASSERT the expired ask has no answer control: the "red" answer button is still visible',
    );
});
