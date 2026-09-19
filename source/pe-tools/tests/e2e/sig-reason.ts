// SIG-REASON · A disabled commit verb gives its reason on hover and on keyboard focus, never as
// inline text. No Revit needed: with no session nothing is staged, so push is refused.
// ASSUME(kai): reason on hover+focus | alt: 2026-08-16 inline reason for commit
// Red: 9683205 renders the reason inline at rest, and the disabled button takes no focus.
import { journey, SITUATION, WEB } from "./cdp.ts";

const PUSH = `[...document.querySelectorAll(${JSON.stringify(`${SITUATION} button`)})].find((e) => e.getClientRects().length && /^push\\b/i.test(e.innerText.trim()))`;

await journey("SIG-REASON", async (page, step) => {
  step(`open ${WEB}/schedules`);
  await page.open(`${WEB}/schedules`);
  const reason = await page.until(
    () => page.read<string | null>(`(${PUSH})?.title || null`),
    "the push verb and its reason",
    30_000,
  );
  step(`push reason: "${reason}"`);
  const shown = async () => (await page.text()).includes(reason);
  const move = (x: number, y: number) =>
    page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

  await move(1, 1);
  await new Promise((r) => setTimeout(r, 300));
  if (await shown()) throw new Error("ASSERT the reason is not drawn at rest");

  step("hover push");
  const box = await page.read<{ x: number; y: number }>(
    `(() => { const r = (${PUSH}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await move(box.x, box.y);
  await page.until(shown, "the reason on hover", 3000).catch(() => {
    throw new Error("ASSERT hovering push shows its reason");
  });
  await move(1, 1);
  await page.until(async () => !(await shown()), "the reason to hide", 3000).catch(() => {
    throw new Error("ASSERT the reason hides when the pointer leaves");
  });

  step("Tab to push");
  const focused = () => page.read<boolean>(`document.activeElement === (${PUSH})`);
  for (let i = 0; i < 80 && !(await focused()); i++) await page.press("Tab");
  if (!(await focused())) throw new Error("ASSERT the keyboard reaches the disabled push verb");
  if (!(await shown())) throw new Error("ASSERT focusing push shows its reason");
});
