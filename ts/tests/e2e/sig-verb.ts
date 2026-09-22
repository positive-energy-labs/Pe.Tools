// SIG-VERB · One verb, one control: /schedules draws `push` once, as the stage verb in the Situation.
// No Revit needed: the verb draws with or without a session. Red: 9683205 also draws the pane's
// AddressingBar "push 0 to Revit".
import { journey, SITUATION, WEB } from "./cdp.ts";

await journey("SIG-VERB", async (page, step) => {
  step(`open ${WEB}/schedules`);
  await page.open(`${WEB}/schedules`);
  await page.until(() => page.has(/^push\b/, SITUATION), "the Situation's push verb", 30_000);
  const pushes = await page.read<{ text: string; inSituation: boolean }[]>(`
    [...document.querySelectorAll("button, [role=button]")]
      .filter((e) => e.getClientRects().length && /\\bpush\\b/i.test(e.innerText))
      .map((e) => ({ text: e.innerText.trim(), inSituation: !!e.closest(${JSON.stringify(SITUATION)}) }))`);
  step(`visible push controls: ${JSON.stringify(pushes)}`);
  if (pushes.length !== 1 || !pushes[0]!.inSituation)
    throw new Error(
      `ASSERT exactly one push control, the Situation's stage verb: got ${JSON.stringify(pushes)}`,
    );
});
