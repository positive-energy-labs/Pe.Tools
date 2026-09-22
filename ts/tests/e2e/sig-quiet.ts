// SIG-QUIET · Silence by default, and no session facts in the panes. /schedules with no session
// draws no absence prose, no work meter and no bridge chip. No Revit needed.
// Red: 9683205 draws "unwritten", "nothing has run on this page yet", "Select an available
// document…" twice, and "bridge connecting" in the pane header.
import { expectText, journey, WEB } from "./cdp.ts";

const ABSENT: [RegExp, string][] = [
  [/\bunwritten\b/, "the Situation's work meter"],
  [/nothing has run/i, "the log's empty line"],
  [/No unresolved actions/i, "the receipts' empty line"],
  [/Select an available document/i, "the no-session strip"],
  [/Staged cells retain/i, "the staged-retain strip"],
  [/An apply occurred/i, "the apply-occurred strip"],
  [/\bbridge\b/i, "the bridge chip (a session fact in a pane header)"],
  [/^\d+×\d+$/m, "the columns×rows chip"],
];

await journey("SIG-QUIET", async (page, step) => {
  step(`open ${WEB}/schedules`);
  await page.open(`${WEB}/schedules`);
  // The route has settled once its Situation draws its verbs.
  await page.until(() => page.has(/^push\b/), "the push verb", 30_000);
  await new Promise((r) => setTimeout(r, 3000));
  const text = await page.text();
  const hits = ABSENT.filter(([re]) => re.test(text)).map(([re, what]) => `${what} ${re}`);
  step(`absence prose found: ${hits.length ? hits.join("; ") : "none"}`);
  for (const [re, what] of ABSENT) expectText(text, re, `no ${what}`, false);
});
