/**
 * Shared human scope gesture used by H1 and J6. The option includes its staged-cell count.
 * The cell may already name the fan when Pea chose the scope with its edit (J6, D28), so the open
 * press accepts either face.
 */
export async function pickFansWriteScope(
  fan: string,
  press: (scope: string, pattern: string) => Promise<unknown>,
  wait: (scope: string, pattern: string) => Promise<unknown>,
) {
  const scope = '[data-choice-cell="Write scope"]';
  const label = fan.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await press(scope, `^(None|${label} · )`);
  // The choice cell's own popup (kit cell.tsx), not the first listbox shown: with Pea open, that is
  // its threads list (D39, J6 at b83d4da7).
  await press('[role="listbox"][aria-label="options"]', `^${label} · \\d+ staged`);
  await wait(scope, `^${label} · `);
}
