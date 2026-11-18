/**
 * Shared human scope gesture used by H1 and J6. The option includes its staged-cell count.
 * The cell may already name the fan when Pea chose the scope with its edit (J6, D28), so the open
 * press accepts either face.
 * E2E_UNIT_ID supplies the independently known unit identity when the popup has no mark.
 */
export async function pickFansWriteScope(
  fan: string,
  press: (scope: string, pattern: string) => Promise<unknown>,
  wait: (scope: string, pattern: string) => Promise<unknown>,
  unitId = process.env.E2E_UNIT_ID,
) {
  const scope = '[data-choice-cell="Write scope"]';
  const mark = fan.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (unitId && !/^[1-9]\d*$/.test(unitId)) throw Error("PRECONDITION: E2E_UNIT_ID must be a unit id");
  const label = unitId ? `(${mark}|unit ${unitId})` : mark;
  await press(scope, `^(None|${label} · )`);
  // The choice cell's own popup (kit cell.tsx), not the first listbox shown: with Pea open, that is
  // its threads list (D39, J6 at b83d4da7).
  await press('[role="listbox"][aria-label="options"]', `^${label} · \\d+ staged`);
  await wait(scope, `^${label} · `);
}
